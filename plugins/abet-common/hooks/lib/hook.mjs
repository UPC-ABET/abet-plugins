/**
 * Hook I/O helpers.
 *
 * A PreToolUse hook communicates its verdict through stdout JSON with exit 0.
 * Emitting nothing (and exiting 0) leaves the normal permission flow untouched.
 */

export async function readInput() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    return {};
  }
}

/** Block the tool call. `reason` is shown to Claude so it can correct course. */
export function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  }));
  process.exit(0);
}

/** Let the call through but surface a note to the user. */
export function warn(message) {
  process.stdout.write(JSON.stringify({ systemMessage: message }));
  process.exit(0);
}

/** No opinion — normal permission flow applies. */
export function allow() {
  process.exit(0);
}

/**
 * Wrap a hook body so an unexpected error never blocks the user's work.
 * A crashing policy hook must fail open, not wedge the session.
 */
export function run(main) {
  main().catch((err) => {
    process.stderr.write(`[abet-hook] ${err?.stack || err}\n`);
    process.exit(0);
  });
}

export function bashCommand(input) {
  if (input?.tool_name !== 'Bash') return null;
  const cmd = input?.tool_input?.command;
  return typeof cmd === 'string' ? cmd : null;
}
