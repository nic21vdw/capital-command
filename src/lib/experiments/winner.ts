import type { Baseline } from "@/lib/experiments/baselines";
import { MIN_VARIANT_VIEWS, TIE_MARGIN, VIEWS_WEIGHT } from "@/lib/experiments/types";

export type Baselines = Record<string, Baseline>;

export type PostScore = {
  variantId: string;
  platform: string;
  accountId: string;
  views: number;
  engagementRate: number | null;
};

export type VariantScore = {
  variantId: string;
  views: number;
  posts: number;
  normalisedPosts: number;
  viewsIndex: number | null;
  rateIndex: number | null;
  score: number | null;
};

export type WinnerResult = {
  outcome: "winner" | "tie" | "not-enough-data";
  winnerId: string | null;
  runnerUpId: string | null;
  tiedIds: string[];
  scores: VariantScore[];
  message: string;
};

export type WinnerInput = {
  variantIds: string[];
  posts: PostScore[];
  baselines: Baselines;
  minViews?: number;
  tieMargin?: number;
  viewsWeight?: number;
};

const mean = (values: number[]): number | null => (values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length);

function scoreVariant(variantId: string, posts: PostScore[], baselines: Baselines): VariantScore {
  const own = posts.filter((post) => post.variantId === variantId);
  const viewIndices: number[] = [];
  const rateIndices: number[] = [];
  for (const post of own) {
    const baseline = baselines[`${post.platform}:${post.accountId}`];
    if (!baseline || baseline.views <= 0) continue;
    viewIndices.push(post.views / baseline.views);
    if (post.engagementRate !== null && baseline.engagementRate !== null && baseline.engagementRate > 0) {
      rateIndices.push(post.engagementRate / baseline.engagementRate);
    }
  }
  return {
    variantId,
    views: own.reduce((sum, post) => sum + post.views, 0),
    posts: own.length,
    normalisedPosts: viewIndices.length,
    viewsIndex: mean(viewIndices),
    rateIndex: mean(rateIndices),
    score: null
  };
}

function notEnough(scores: VariantScore[], message: string): WinnerResult {
  return { outcome: "not-enough-data", winnerId: null, runnerUpId: null, tiedIds: [], scores, message: `Not enough data: ${message}` };
}

export function chooseWinner(input: WinnerInput): WinnerResult {
  const minViews = input.minViews ?? MIN_VARIANT_VIEWS;
  const margin = input.tieMargin ?? TIE_MARGIN;
  const weight = input.viewsWeight ?? VIEWS_WEIGHT;
  const scores = input.variantIds.map((id) => scoreVariant(id, input.posts, input.baselines));

  const empty = scores.find((entry) => entry.posts === 0);
  if (empty) return notEnough(scores, `variant ${empty.variantId} has no post that could be measured.`);

  const thin = scores.find((entry) => entry.views < minViews);
  if (thin) {
    return notEnough(scores, `variant ${thin.variantId} reached ${Math.round(thin.views)} views and the minimum is ${minViews} per variant.`);
  }

  const unmatched = scores.find((entry) => entry.normalisedPosts === 0);
  if (unmatched) {
    return notEnough(scores, `variant ${unmatched.variantId} was posted where there is no usual level to compare against yet (an account needs a few earlier posts for a baseline).`);
  }

  const useRate = scores.every((entry) => entry.rateIndex !== null);
  for (const entry of scores) {
    entry.score = useRate ? weight * entry.viewsIndex! + (1 - weight) * entry.rateIndex! : entry.viewsIndex;
  }

  const ranked = [...scores].sort((a, b) => b.score! - a.score! || a.variantId.localeCompare(b.variantId));
  const top = ranked[0];
  const tied = ranked.filter((entry) => top.score! < entry.score! * (1 + margin) || top.score! === entry.score!);
  if (tied.length > 1) {
    const names = tied.map((entry) => entry.variantId).sort();
    return {
      outcome: "tie",
      winnerId: null,
      runnerUpId: null,
      tiedIds: names,
      scores,
      message: `Too close to call: ${names.join(" and ")} finished within ${Math.round(margin * 100)}% of each other.`
    };
  }
  return {
    outcome: "winner",
    winnerId: top.variantId,
    runnerUpId: ranked[1]?.variantId ?? null,
    tiedIds: [],
    scores,
    message: `Variant ${top.variantId} won: it scored ${top.score!.toFixed(2)} against ${ranked[1].score!.toFixed(2)} for ${ranked[1].variantId}, where 1.00 is a typical post for the account.`
  };
}
