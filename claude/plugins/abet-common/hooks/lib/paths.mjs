/**
 * Which paths the policy checks should leave alone.
 *
 * Generated and vendored files are not authored, so linting, formatting or secret-scanning
 * them produces findings nobody can act on. A lockfile is the clearest case: it is not
 * Prettier-formatted, no repo's `format` script targets it, and rewriting one to satisfy a
 * formatter risks breaking the package manager that owns it.
 */

/** Machine-generated: never format-check, never lint, never scan. */
const GENERATED = [
  /(^|\/)(package-lock\.json|pnpm-lock\.yaml|npm-shrinkwrap\.json|yarn\.lock|bun\.lockb?)$/,
  /(^|\/)(node_modules|dist|build|coverage|out|\.next|\.turbo|\.nest)\//,
  /(^|\/)openapi\.json$/,
];

/** Not text we can meaningfully inspect. */
const BINARY = /\.(png|jpe?g|gif|webp|avif|svg|ico|pdf|xlsx?|docx?|pptx?|zip|gz|tar|bak|woff2?|ttf|eot|mp4|mov)$/i;

/** Examples and fixtures where a credential-shaped string is expected. */
const EXAMPLE = /(^|\/)\.env\.example$/;

export const isGenerated = (path) => GENERATED.some((re) => re.test(path));
export const isBinary = (path) => BINARY.test(path);

/** True when a formatter or linter should be pointed at this file. */
export const isAuthored = (path) => !isGenerated(path) && !isBinary(path);

/** True when the secret scanner should read this file's added lines. */
export const isScannable = (path) => isAuthored(path) && !EXAMPLE.test(path);
