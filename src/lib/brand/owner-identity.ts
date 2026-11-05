export type OwnerIdentity = {
  name: string;
  firstName: string;
  surname: string;
  handle: string;
  role: string;
  links: { site: string; youtube: string; x: string };
  storyRule: string;
  docsBaseUrl: string;
  alreadyOnYoutubeSeries: RegExp[];
};

export const OWNER_IDENTITY: OwnerIdentity = {
  name: "Nic Vandewetering",
  firstName: "Nic",
  surname: "Vandewetering",
  handle: "@nicvandewetering",
  role: "Founder and builder of CoLateral",
  links: {
    site: "https://colateralai.com",
    youtube: "https://www.youtube.com/@nicvandewetering",
    x: "https://x.com/nic21vdw"
  },
  storyRule:
    "{firstName}'s own story is fine: an engineer by day job who builds software and builds CoLateral in public. That is his background, not a product claim.",
  docsBaseUrl: "https://github.com/nic21vdw/capital-command/blob/main/",
  alreadyOnYoutubeSeries: [/Yapping\s+Until\s+I\s+Can\s+Buy\s+a\s+Nicer\s+Car/i]
};
