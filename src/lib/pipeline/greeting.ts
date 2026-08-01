// The Stream Pipeline's landing headline. It used to read "Ready when you are."
// on every visit; now it's a line of the day — locker-room coaching in the
// house voice, one per day, the same one all day so the page doesn't shuffle
// itself under you on a reload.

export const PIPELINE_QUOTES = [
  "Keep your stick on the ice, Jamie.",
  "Keep your chin tucked, Jamie.",
  "Ready, shoot, aim, Jamie.",
  "Skate to where the puck is going, Jamie.",
  "You miss every shot you don't take, so take a bad one.",
  "Nobody ever got faster by waiting for the ice to be perfect.",
  "Ship it ugly, then make it pretty.",
  "The first period is for finding out. The third is for finishing.",
  "Shoulders square, eyes up, publish.",
  "Heavy legs still score. Get out there.",
  "Momentum is a decision you make before noon.",
  "One shift at a time. That's the whole system.",
  "Grind the boards. The goals come off the boards.",
  "Don't admire the pass. Take the shot.",
  "Your worst upload beats your best draft.",
  "Play the whistle, not the scoreboard.",
  "Nobody watches the video you didn't post.",
  "Chase the rebound. That's where the work is.",
  "Perfect is a stall tactic wearing a nice jersey.",
  "Get the puck deep and go to work.",
  "Every stream is footage you haven't spent yet.",
  "Tape the stick, tie the skates, hit the ice.",
  "Small edges, stacked daily, look like luck later.",
  "You don't need a better idea. You need a finished one.",
  "Backcheck on your own excuses, Jamie.",
  "Bury it. Celebrate later.",
  "Two feet moving beats a great plan standing still.",
  "The bounce goes to whoever showed up.",
  "Head on a swivel, hands soft, keep building.",
  "Nothing gets sharper sitting in the folder."
] as const;

/**
 * The quote for a given calendar day. Deterministic on the local date, so a
 * reload shows the same line and midnight turns it over.
 */
export function quoteOfTheDay(date: Date = new Date()): string {
  const day = Math.floor(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000
  );
  const index = ((day % PIPELINE_QUOTES.length) + PIPELINE_QUOTES.length) % PIPELINE_QUOTES.length;
  return PIPELINE_QUOTES[index];
}
