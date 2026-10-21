# Exact connection prerequisites

Source/configuration audit, 2026-10-21. The existing supported route is CoLateral's desktop card to the same machine's Marketing process on port 3000. The next missing fact is now specific: a Tailscale executable is installed, but reading its saved serving configuration was denied by the administrator-protected local IPC pipe. No remote worker connection was attempted. No live record, secret value or remote private host was inspected.

Target is the **existing owning capital-command Node/Next process**. package.json and scripts/start-server.ps1 bind 127.0.0.1:3000; scripts/open-app.ps1 opens localhost. It needs writable persistent local storage and FFmpeg. Process-global pipeline maps must not be co-written by a second worker/CLI. The Cloudflare Site cannot execute these subprocesses.

Tracked R2/S3 facilities host objects. COLATERAL_ATTRIBUTION_URL is an outbound sales-summary read. Neither provides worker ingress. No deployed marketing tunnel/proxy was found in tracked configuration. Original Google/TikTok OAuth connects social accounts and can rearm publishing; do not reuse it as Site authentication.

## Existing infrastructure findings

Permitted original configuration reads confirmed R2 object storage with no public base URL, and CoLateral's Convex billing/licence backend. Neither is a Marketing relay. The desktop card in CoLateral-AI/src/canvas/capitalCommandCard.js defaults to 127.0.0.1:3000, accepts only local frame hosts and refuses HTTPS-parent framing. The existing bridge on 8737 provides paired local CLI/control access, not Marketing record/account scopes. Its pairing token is not a substitute for the Site identity.

Read-only local executable/service metadata found C:/Program Files/Tailscale/tailscale.exe. Get-Service found neither the exact `Tailscale` nor `cloudflared` service name; the conventional Cloudflare install directories and ~/.cloudflared did not exist. Those checks do not prove the absence of differently named services or configurations. No services were started or stopped.

The sole local IPC read `tailscale serve status --json` exited 1 before returning configuration:

```
getting serve config: Get "http://local-tailscaled.sock/localapi/v0/serve-config": open \\.\pipe\ProtectedPrefix\Administrators\Tailscale\tailscaled: Access is denied.
```

Status: **denied, known not executed successfully**. No retry or alternate pipe access was attempted. This is a local configuration-read denial, not a denied hosted worker connection. The repository metadata enumeration using git -C also returned Permission denied and stopped; permitted explicit source/config reads do not establish the original deployed build identity.

## Exact next approval decision

The smallest next input is an operator-supplied, sanitized existing HTTPS hostname/path and its mapping to this machine's owning port-3000 process, together with the operator and active build provenance. Supplying existing configuration avoids another privileged discovery action. Do not send a token, unrelated routes or private record payloads.

If the operator cannot supply that mapping, request only an administrator-authorized, read-only `tailscale serve status --json` on this existing Windows machine, with output restricted to any existing port-3000 route, its hostname/path and any saved Funnel setting returned; omit credentials and unrelated routes. This reads existing local configuration. It does not establish reachability or Funnel eligibility, install/start Tailscale, enable Funnel, change ACLs, create a credential, expose a listener or contact the Marketing app. The agent must obtain fresh action-time authorization before retrying the denied read.

If that approved read identifies a configured HTTPS candidate to the owning process, record its exact origin. Operator/upstream ownership and public reachability still require a separately authorized read-only check. Tailnet-only Serve is not automatically reachable from a hosted Site. If it identifies none, **there is no verified existing ingress to connect**: maintaining local desktop operation is the available current option, and adding remote ingress is a separate infrastructure decision. Do not substitute R2, the billing service, the desktop pairing bridge or a guessed brand domain.

Official documentation checked on 2026-10-21 confirms that [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve) shares a local service within the tailnet; [Funnel](https://tailscale.com/docs/features/tailscale-funnel) exposes a selected service publicly. Funnel does not supply Serve's user identity headers. Therefore even a saved Funnel route would establish only an ingress candidate, not the required Site-subject-to-owner authentication or record scopes. Reading the saved configuration creates no new service or spending commitment; the account's current entitlement and any later infrastructure decision remain unverified.

For a possible later new-ingress decision, Cloudflare documents hostname/path-limited Tunnel routes with a 404 catch-all and service-specific Access credentials. That is a documented candidate, not an existing installed service or an approved recommendation to provision it. An account, owned hostname, eligible plan and actual pricing would still need verification; the published free-plan offer does not establish Nic's entitlement or a zero-cost commitment. No new tunnel, Access policy, Windows service, DNS record or grant is proposed for execution in this task. Sources: [Tunnel configuration](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/configuration-file/), [Access service tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/), [plans](https://www.cloudflare.com/plans/zero-trust-services/).

Site platform-injected identity headers authenticate inside the Site gateway only. They are not a transferable Node credential. CONNECTORS has no verified marketing mapping. Do not reuse broad desktop tokens or trust browser identity headers.

After ingress is established, the installation proposal must bind:

1. The exact existing HTTPS origin/operator and its route to the one owning Node process, as established by the local configuration decision above. Keep every other app/bridge route unreachable.
2. Signed assertion/session verifier, audience/issuer and exact Site subject-to-owner mapping. Credential kind/duration unknown; none created.
3. Owner-approved source/run/job/project/queue/export/platform-account/upload allowlists. No inferred ownership or automatic enrollment.
4. Narrow operation allowlist and mutation-origin handling. Original middleware rejects non-loopback writes; an adapter callback alone cannot enable remote access.
5. Owning runtime/version/storage and exact reviewed installation from draft PR508. Site hosting does not authorize that service merge/deployment.

Proposed surface: authenticated GET /api/integrations/marketing/{workspace,records,analytics}, GET /editor/{projectId}, GET|HEAD /media/{mediaId}, explicitly allowlisted POST /operations. Bound read, inert source/preparation, editor save/export and draft-review permissions separately. Public requests cannot claim worker identity, submit outcomes, choose file paths, install transport or publish. Internal renderer permits preparation only, publish:false and schedule:false.

Once those facts exist, name exact origin/operator, identity/scopes, genuinely required credential, cost and service installation actions in the approval request. Until then a vague “connect worker” request conceals missing decisions. State is **unconfigured, not denied or attempted**. No credentials, persistent grants, new services or schedules were created.

The first proposed runtime scope is `read` for one explicitly bound Site subject/Marketing owner and named existing source/run/job/project/queue/export/platform-account IDs. No automatic enrollment, wildcard owner or provider-token access. After read-only hosted proof, separately reviewed operation allowlists can enable existing editor save/delete/export-intent and source preparation. All rendering stays inside the current owning process; prepare:true, publish:false and schedule:false. No second worker process writes the original stores. Any reviewed installation of PR508 into the original service remains a distinct action-time approval; the Site-hosting permission does not cover it.

The direct Site MCP check returned 401 and was not retried. Review of the supported Sites service-access instructions showed the check omitted the required `Bearer ` prefix. Such a service token also supplies neither a visitor identity nor app consent. The failed check is not evidence that a correctly authenticated owner call or worker transport succeeds or fails. The installed native workspace read remains the verified hosted observation: unconfigured and mutation capabilities false.

A real stream-to-post acceptance test separately needs exact content, platform/account, visibility and time authorization. No cutover/migration authorized.

