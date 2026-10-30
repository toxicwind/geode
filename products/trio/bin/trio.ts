#!/usr/bin/env bun
/**
 * trio CLI — persistent Bun notebook kernel.
 *
 *   trio run '<code>'            one-shot cell (own kernel)
 *   trio --session NAME run ...  persistent session (daemon kernel, survives CLI exit)
 *   trio --session NAME reset    drop user bindings in a session
 *   trio status                  kernel counts (default session)
 *   trio serve                   newline-delimited JSON protocol on stdio
 */
import { parseArgs } from "node:util";
import { TrioKernel } from "../src/kernel.ts";
import { runStdioServer } from "../src/server.ts";
import { sessionReset, sessionRun, sessionStatus } from "../src/session.ts";

const { values, positionals } = parseArgs({
	options: {
		session: { type: "string", short: "s" },
		help: { type: "boolean", short: "h" },
	},
	allowPositionals: true,
});

if (values.help) {
	console.log(`Usage:
  trio run '<code>'
  trio --session NAME run '<code>'
  trio --session NAME reset
  trio status
  trio [--session NAME] serve`);
	process.exit(0);
}

const command = positionals[0] ?? "run";
const sessionName = values.session ?? "default";

// The stdio/socket server owns a kernel in-process; every other command uses a
// session daemon (or a throwaway kernel for bare one-shot runs) so persistent
// state survives between CLI invocations.
if (command === "serve") {
	const kernel = new TrioKernel({ name: sessionName });
	await runStdioServer(kernel);
	process.exit(0);
}

if (values.session !== undefined || command === "status") {
	if (command === "reset") {
		const result = await sessionReset(sessionName);
		console.log(result.ok ? `reset ${sessionName}` : `reset failed: ${result.error}`);
		process.exit(result.ok ? 0 : 1);
	}
	if (command === "status") {
		const result = await sessionStatus(sessionName);
		if (!result.ok) {
			process.stderr.write(`${result.error}\n`);
			process.exit(1);
		}
		console.log(JSON.stringify(result.status, null, 2));
		process.exit(0);
	}
	if (command === "run") {
		const code = positionals[1];
		if (code === undefined) {
			console.error("usage: trio --session NAME run '<code>'");
			process.exit(1);
		}
		const result = await sessionRun(sessionName, code);
		if (result.text) process.stdout.write(result.text);
		if (!result.ok) {
			process.stderr.write(`${result.error}\n`);
			process.exit(1);
		}
		if (result.value !== undefined) {
			process.stdout.write(
				typeof result.value === "string"
					? `${result.value}\n`
					: `${JSON.stringify(result.value, null, 2)}\n`,
			);
		}
		process.exit(0);
	}
	console.error(`unknown command: ${command}`);
	process.exit(1);
}

// Bare one-shot: fresh kernel, no daemon.
if (command === "run") {
	const code = positionals[1];
	if (code === undefined) {
		console.error("usage: trio run '<code>'");
		process.exit(1);
	}
	const kernel = new TrioKernel({ name: "default" });
	const result = await kernel.run(code);
	if (result.text) process.stdout.write(result.text);
	if (!result.ok) {
		process.stderr.write(`${result.error}\n`);
		process.exit(1);
	}
	if (result.value !== undefined) {
		process.stdout.write(
			typeof result.value === "string" ? `${result.value}\n` : `${JSON.stringify(result.value, null, 2)}\n`,
		);
	}
	process.exit(0);
}

console.error(`unknown command: ${command}`);
process.exit(1);