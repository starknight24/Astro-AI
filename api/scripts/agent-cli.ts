/**
 * Run the agent from the command line and print the whole trace.
 *
 *   npx tsx scripts/agent-cli.ts "orbital period at 400 km?"
 *   npx tsx scripts/agent-cli.ts --json "..."   # raw result, for piping
 *
 * Needs GEMINI_API_KEY and SCIENCE_URL in api/.env. Exists because the project's
 * premise is an inspectable agent: this is the shortest path from a prompt to
 * plan, tool calls, tool results and synthesis without a browser or auth token.
 */
import "dotenv/config";
import { runAgent } from "../src/agent/loop";
import type { TraceEntry } from "../src/agent/contract";

function printTrace(trace: TraceEntry[]): void {
  for (const e of trace) {
    if (e.type === "tool_call") {
      console.log(
        `[tool] iter=${e.iteration} ${e.tool}(${JSON.stringify(e.raw_args)}) ` +
          `ok=${e.ok} attempts=${e.attempts} ${e.duration_ms}ms` +
          (e.error ? ` err=${e.error}` : ""),
      );
      if (e.coercions)
        console.log(`       coercions: ${e.coercions.join("; ")}`);
      if (e.ok)
        console.log(`       result: ${JSON.stringify(e.result).slice(0, 500)}`);
    } else if (e.type === "tool_round") {
      console.log(
        `[round ${e.iteration}] model ${e.duration_ms}ms tokens=${e.tokens_in}/${e.tokens_out} ` +
          `requested ${e.calls_requested} tool call(s)`,
      );
    } else if (e.type === "guardrail") {
      console.log(`[guardrail] ${e.name}: ${e.detail}`);
    } else {
      console.log(
        `[${e.type}] ${e.duration_ms}ms tokens=${e.tokens_in}/${e.tokens_out}`,
      );
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const jsonOnly = args[0] === "--json";
  const problem = (jsonOnly ? args.slice(1) : args).join(" ");
  if (!problem) {
    console.error('usage: tsx scripts/agent-cli.ts [--json] "<problem>"');
    process.exit(2);
  }

  const result = await runAgent({ problem });

  if (jsonOnly) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const rule = "=".repeat(78);
  console.log(rule);
  console.log(`PROBLEM: ${problem}`);
  console.log(`request_id: ${result.request_id}  status: ${result.status}`);
  console.log(rule);

  console.log("\n--- PLAN ---");
  console.log(
    `in_domain: ${result.plan?.in_domain} | ${result.plan?.domain_reason}`,
  );
  console.log(`restated: ${result.plan?.restated_problem}`);
  result.plan?.steps.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
  console.log(
    `tools_expected: ${result.plan?.tools_expected.join(", ") || "(none)"}`,
  );
  console.log(
    `missing_information: ${JSON.stringify(result.plan?.missing_information ?? [])}`,
  );

  console.log("\n--- TRACE ---");
  printTrace(result.trace);

  console.log("\n--- ANSWER ---");
  console.log(`status: ${result.answer.status}`);
  if (result.answer.steps.length > 0) console.log("\nSTEPS:");
  for (const s of result.answer.steps) {
    console.log(`  ${s.step}. ${s.description}`);
    if (s.formula) console.log(`     formula: ${s.formula}`);
    if (s.substitution) console.log(`     substitution: ${s.substitution}`);
    if (s.result) console.log(`     result: ${s.result}`);
    if (s.tool) console.log(`     tool: ${s.tool}`);
  }
  if (result.answer.formulas.length > 0) {
    console.log("\nFORMULAS:");
    for (const f of result.answer.formulas) console.log(`  ${f}`);
  }
  if (result.answer.citations.length > 0) {
    console.log("\nCITATIONS:");
    for (const c of result.answer.citations)
      console.log(`  [${c.tool}] ${c.source} -> ${c.detail}`);
  }
  if (result.answer.quantities.length > 0) {
    console.log("\nQUANTITIES:");
    for (const q of result.answer.quantities)
      console.log(`  ${q.quantity} = ${q.value} ${q.unit}`);
  }
  console.log(`\nFINAL ANSWER:\n  ${result.answer.final_answer}`);
  if (result.answer.caveats?.length) {
    console.log("\nCAVEATS:");
    for (const c of result.answer.caveats) console.log(`  - ${c}`);
  }
  console.log("\n--- META ---");
  console.log(JSON.stringify(result.meta, null, 2));
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
