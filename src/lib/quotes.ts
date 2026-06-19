export interface Quote {
  text: string;
  author: string;
}

/**
 * A curated set of inspirational quotes geared toward investing, discipline,
 * and the long game. Kept intentionally evergreen so the rotation always feels
 * relevant on the Nic Vandewetering dashboard.
 */
export const QUOTES: Quote[] = [
  { text: "The stock market is a device for transferring money from the impatient to the patient.", author: "Warren Buffett" },
  { text: "An investment in knowledge pays the best interest.", author: "Benjamin Franklin" },
  { text: "Risk comes from not knowing what you're doing.", author: "Warren Buffett" },
  { text: "The individual investor should act consistently as an investor and not as a speculator.", author: "Ben Graham" },
  { text: "In the short run, the market is a voting machine but in the long run, it is a weighing machine.", author: "Benjamin Graham" },
  { text: "Do not save what is left after spending, but spend what is left after saving.", author: "Warren Buffett" },
  { text: "The four most dangerous words in investing are: 'this time it's different.'", author: "Sir John Templeton" },
  { text: "Know what you own, and know why you own it.", author: "Peter Lynch" },
  { text: "Wide diversification is only required when investors do not understand what they are doing.", author: "Warren Buffett" },
  { text: "The big money is not in the buying and the selling, but in the waiting.", author: "Charlie Munger" },
  { text: "Compound interest is the eighth wonder of the world. He who understands it, earns it.", author: "Albert Einstein" },
  { text: "Time in the market beats timing the market.", author: "Ken Fisher" },
  { text: "Be fearful when others are greedy, and greedy when others are fearful.", author: "Warren Buffett" },
  { text: "Price is what you pay. Value is what you get.", author: "Warren Buffett" },
  { text: "The most important quality for an investor is temperament, not intellect.", author: "Warren Buffett" },
  { text: "How many millionaires do you know who have become wealthy by investing in savings accounts? I rest my case.", author: "Robert G. Allen" },
  { text: "It's not how much money you make, but how much money you keep.", author: "Robert Kiyosaki" },
  { text: "The goal isn't more money. The goal is living life on your terms.", author: "Chris Brogan" },
  { text: "Discipline is the bridge between goals and accomplishment.", author: "Jim Rohn" },
  { text: "Success is not final, failure is not fatal: it is the courage to continue that counts.", author: "Winston Churchill" },
  { text: "The best time to plant a tree was 20 years ago. The second best time is now.", author: "Chinese Proverb" },
  { text: "Patience is bitter, but its fruit is sweet.", author: "Aristotle" },
  { text: "Opportunities don't happen. You create them.", author: "Chris Grosser" },
  { text: "What gets measured gets managed.", author: "Peter Drucker" },
  { text: "The expert in anything was once a beginner.", author: "Helen Hayes" },
  { text: "Formal education will make you a living; self-education will make you a fortune.", author: "Jim Rohn" },
  { text: "Every once in a while, the market does something so stupid it takes your breath away.", author: "Jim Cramer" },
  { text: "The market can stay irrational longer than you can stay solvent.", author: "John Maynard Keynes" },
  { text: "Rule No. 1: Never lose money. Rule No. 2: Never forget rule No. 1.", author: "Warren Buffett" },
  { text: "An idiot with a plan can beat a genius without a plan.", author: "Warren Buffett" },
  { text: "Far more money has been lost by investors preparing for corrections than has been lost in the corrections themselves.", author: "Peter Lynch" },
];

/**
 * Returns the number of whole days since the Unix epoch for the given date,
 * using the local calendar day. This makes the selection stable within a day
 * and guaranteed to advance exactly once per calendar day.
 */
function dayIndex(date: Date): number {
  const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.floor(startOfDay.getTime() / 86_400_000);
}

/**
 * Picks the quote of the day deterministically from the date, so the same day
 * always shows the same quote and it rotates to a new one each calendar day.
 */
export function getQuoteOfTheDay(date: Date = new Date()): Quote {
  const index = ((dayIndex(date) % QUOTES.length) + QUOTES.length) % QUOTES.length;
  return QUOTES[index];
}
