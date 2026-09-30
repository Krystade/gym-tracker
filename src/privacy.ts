/** Personal data (history, weight, photos, spreadsheets, backups) must never be tracked in this public repo. */
export const FORBIDDEN = [
  /(^|\/)(data|private|gym-data|exports|originals)\//i,
  /\.txt$/i, // free-text training notes; only *.sample.txt and robots.txt are allowed
  /(^|\/)[^/]*(notes|journal)[^/]*\.md$/i,
  /\.(csv|tsv|xlsx?|xlsm|ods|numbers|jpe?g|heic|heif|webp|mov|mp4|sqlite|db)$/i,
  /(^|\/)gym-backup[^/]*\.json$/i,
];
export const ALLOWED = [/\.sample\.(csv|txt)$/i, /(^|\/)robots\.txt$/i];

export function violations(paths: string[]): string[] {
  return paths.filter((p) => FORBIDDEN.some((re) => re.test(p)) && !ALLOWED.some((re) => re.test(p)));
}
