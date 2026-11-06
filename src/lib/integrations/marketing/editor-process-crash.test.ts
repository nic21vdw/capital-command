import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { resolveFfmpeg } from "@/lib/clipping/ffmpeg";
import { getEditorWorkerEpoch, inspectEditorAttempt, readEditorCancellationSettlement } from "./editor-active-attempts";

it("records actual owning Node termination separately from reconstruction and never infers prior-epoch child settlement", async () => {
  const token = randomUUID();
  const evidenceDir = path.join(process.cwd(), ".test-artifacts", "cancellation");
  await mkdir(evidenceDir, { recursive: true });
  const output = path.join(evidenceDir, `crash-${token}.mp4`);
  const helper = path.join(evidenceDir, `crash-${token}.cjs`);
  const identity = { ownerId: "synthetic-crash-owner", projectId: "project", jobId: "job", clipId: "clip",
    sourceFile: "source.mp4", sourceSha256: "a".repeat(64), requestId: randomUUID(), attemptId: randomUUID() };
  const target = { revision: 1, digest: "b".repeat(64), renderSignature: "synthetic1", overlayAssetsSha256: "c".repeat(64) };
  await writeFile(helper, `
const {spawn}=require('node:child_process');
const {runEditorAttempt,getEditorWorkerEpoch}=require(${JSON.stringify(path.join(process.cwd(), "src/lib/integrations/marketing/editor-active-attempts.ts"))});
const identity={...${JSON.stringify(identity)},workerEpoch:getEditorWorkerEpoch()};
runEditorAttempt(identity,async lease=>{
  lease.bindTarget(${JSON.stringify(target)});
  const child=spawn(${JSON.stringify(resolveFfmpeg())},['-y','-re','-f','lavfi','-i','color=c=navy:s=160x90:r=10:d=10','-an','-c:v','libx264','-pix_fmt','yuv420p',${JSON.stringify(output)}],{windowsHide:true});
  let ready=false;
  child.stderr.on('data',chunk=>{if(!ready&&/frame=\\s*[1-9]/.test(String(chunk))){ready=true;process.send({token:${JSON.stringify(token)},identity,pid:child.pid,output:${JSON.stringify(output)}});}});
  child.stdout.resume();
  const abort=()=>child.kill('SIGKILL');lease.signal.addEventListener('abort',abort,{once:true});
  await new Promise((resolve,reject)=>{let error;child.on('error',e=>{error=e;});child.on('close',code=>{lease.signal.removeEventListener('abort',abort);error?reject(error):code===0?resolve():reject(new Error('child exit '+code));});});
}).catch(()=>{process.exitCode=1;});
`);
  const owner = spawn(process.execPath, ["--require", "tsx/cjs", helper], { cwd: process.cwd(), windowsHide: true,
    stdio: ["ignore", "pipe", "pipe", "ipc"] });
  let stderr = ""; owner.stderr!.on("data", (chunk) => { stderr = (stderr + String(chunk)).slice(-4000); }); owner.stdout!.resume();
  let ownerClosed = false; const ownerClose = new Promise<void>((resolve) => owner.once("close", () => { ownerClosed = true; resolve(); }));
  let childPid: number | undefined;
  let childIdentity: typeof identity & { workerEpoch: string };
  const exists = (pid: number) => { try { process.kill(pid, 0); return true; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false; throw error;
  } };
  let observedChildSurvived: boolean | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Synthetic crash helper did not start: ${stderr}`)), 12_000);
      owner.once("error", (error) => { clearTimeout(timeout); reject(error); });
      owner.once("message", (raw) => {
        const message = raw as { token: string; identity: typeof childIdentity; pid: number; output: string };
        clearTimeout(timeout);
        if (message.token !== token || message.output !== output || message.identity.requestId !== identity.requestId
          || message.identity.attemptId !== identity.attemptId || !Number.isSafeInteger(message.pid) || message.pid <= 0 || message.pid === owner.pid) {
          reject(new Error("Synthetic child identity did not match its private helper.")); return;
        }
        childPid = message.pid; childIdentity = message.identity; resolve();
      });
    });
    expect(exists(childPid!)).toBe(true); expect(childIdentity!.workerEpoch).not.toBe(getEditorWorkerEpoch());
    expect(owner.kill("SIGKILL")).toBe(true); await ownerClose;
    expect(ownerClosed).toBe(true);
    observedChildSurvived = exists(childPid!);
    expect(inspectEditorAttempt(childIdentity!, target).status).toBe("prior_epoch");
    expect(readEditorCancellationSettlement(childIdentity!, target, randomUUID())).toBeNull();
  } finally {
    // Only these newly created synthetic handles/PIDs may be terminated. The
    // FFmpeg input is also intrinsically limited to ten seconds if cleanup fails.
    if (!ownerClosed) { owner.kill("SIGKILL"); await ownerClose; }
    if (childPid && exists(childPid)) process.kill(childPid, "SIGKILL");
    if (childPid) await vi.waitUntil(() => !exists(childPid!), { timeout: 12_000, interval: 25 });
    await writeFile(path.join(evidenceDir, "actual-node-crash.json"), JSON.stringify({ syntheticOnly: true, token,
      ownerPid: owner.pid, childPid, ownerClosed, observedChildSurvived, childAbsentAfterExactCleanup: childPid ? !exists(childPid) : null,
      qualification: "Actual owned Node SIGKILL with an actual FFmpeg child. OS survival observation is diagnostic, not a universal crash guarantee; prior epoch supplies no canceled proof."
    }, null, 2));
  }
}, 30_000);
