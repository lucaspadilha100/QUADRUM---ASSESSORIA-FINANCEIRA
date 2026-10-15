export const cn = (...a: Array<string | false | null | undefined>) =>
  a.filter(Boolean).join(" ");
