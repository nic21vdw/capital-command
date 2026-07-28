import type { LaunchStats } from "@/lib/launch/types";

const ENDPOINT = "https://api.producthunt.com/v2/api/graphql";

const POST_QUERY = `query Post($slug: String!) {
  post(slug: $slug) {
    id
    name
    tagline
    slug
    url
    votesCount
    commentsCount
    featuredAt
    createdAt
  }
}`;

const DAY_QUERY = `query Day($after: DateTime!, $before: DateTime!) {
  posts(order: VOTES, postedAfter: $after, postedBefore: $before, first: 20) {
    edges {
      node {
        id
        slug
        votesCount
      }
    }
  }
}`;

interface PostNode {
  id: string;
  name: string;
  tagline: string;
  slug: string;
  url: string;
  votesCount: number;
  commentsCount: number;
  featuredAt: string | null;
  createdAt: string;
}

export function productHuntToken() {
  return process.env.PRODUCT_HUNT_TOKEN?.trim() || null;
}

export function productHuntConfigured() {
  return productHuntToken() !== null;
}

/**
 * A listing URL, a slug, or anything in between — the settings field should
 * accept whatever the user pastes out of the browser.
 */
export function normalizeSlug(input: string) {
  const trimmed = input.trim();
  if (!trimmed) return "";
  const match = trimmed.match(/producthunt\.com\/(?:posts|products)\/([^/?#]+)/i);
  return (match ? match[1] : trimmed).replace(/^\/+|\/+$/g, "").toLowerCase();
}

async function query<T>(token: string, body: { query: string; variables: Record<string, unknown> }): Promise<T> {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error("Product Hunt rejected the token. Check PRODUCT_HUNT_TOKEN.");
  }
  if (response.status === 429) {
    throw new Error("Product Hunt rate limit reached. Try again in a few minutes.");
  }
  if (!response.ok) {
    throw new Error(`Product Hunt API returned ${response.status}.`);
  }

  const json = (await response.json()) as { data?: T; errors?: { message?: string }[] };
  if (json.errors?.length) {
    throw new Error(json.errors[0]?.message || "Product Hunt API error.");
  }
  if (!json.data) {
    throw new Error("Product Hunt API returned no data.");
  }
  return json.data;
}

function dayBounds(iso: string) {
  const featured = new Date(iso);
  const start = new Date(featured);
  start.setUTCHours(start.getUTCHours() - 12);
  const end = new Date(featured);
  end.setUTCHours(end.getUTCHours() + 24);
  return { after: start.toISOString(), before: end.toISOString() };
}

/**
 * Product Hunt exposes no rank field, so the standing is read off the day's
 * vote-ordered leaderboard. A launch outside the top 20 comes back with a null
 * rank rather than a wrong one.
 */
async function fetchRank(token: string, post: PostNode) {
  const reference = post.featuredAt ?? post.createdAt;
  if (!reference) return { rank: null, dayLaunchCount: null };

  try {
    const data = await query<{ posts: { edges: { node: { id: string; slug: string } }[] } }>(token, {
      query: DAY_QUERY,
      variables: dayBounds(reference)
    });
    const nodes = data.posts.edges.map((edge) => edge.node);
    const index = nodes.findIndex((node) => node.id === post.id || node.slug === post.slug);
    return { rank: index === -1 ? null : index + 1, dayLaunchCount: nodes.length };
  } catch {
    return { rank: null, dayLaunchCount: null };
  }
}

export async function fetchLaunchStats(rawSlug: string): Promise<LaunchStats> {
  const token = productHuntToken();
  if (!token) {
    throw new Error("No PRODUCT_HUNT_TOKEN configured.");
  }
  const slug = normalizeSlug(rawSlug);
  if (!slug) {
    throw new Error("Add the Product Hunt slug or listing URL first.");
  }

  const data = await query<{ post: PostNode | null }>(token, { query: POST_QUERY, variables: { slug } });
  const post = data.post;
  if (!post) {
    throw new Error(`No Product Hunt listing found for "${slug}".`);
  }

  const { rank, dayLaunchCount } = await fetchRank(token, post);

  return {
    votes: post.votesCount,
    comments: post.commentsCount,
    rank,
    dayLaunchCount,
    name: post.name,
    tagline: post.tagline,
    url: post.url,
    featuredAt: post.featuredAt,
    fetchedAt: new Date().toISOString()
  };
}
