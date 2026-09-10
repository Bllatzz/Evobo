// `input` has no published types — used only for the interactive Telegram
// login prompt (phone/2FA/code) in src/index.ts and scripts/discover-dialogs.ts.
declare module "input" {
  function text(message: string): Promise<string>;
  function confirm(message: string): Promise<boolean>;
  const _default: { text: typeof text; confirm: typeof confirm };
  export default _default;
}
