#!/usr/bin/env bun
/**
 * spine — the reactive event plane MVP (architect decision 2026-10-30).
 *
 * Topology (each layer does what it already does best):
 *   squawk-ws (:25147)  — live event fan-out (WS client here)
 *   kafka (:25144)      — durable log of record (console-producer/consumer)
 *   estate-chat (:25120)— per-room delivery to agents
 *   rig (openfang fork) — controller/front (config: ~/.rig/config.toml;
 *                         rig gates + routes — MVP reads an ACL file)
 *
 * No polling: the WS connection IS the awareness. Kafka receipts make the
 * log durable; nothing waits in a queue.
 *
 * MVP behaviors:
 *   spine watch            — WS → kafka receipts + estate-chat relay (excl. self)
 *   spine emit <room> <text> — inject an event (test vector)
 *   spine log [n]          — tail the durable kafka log
 */
import { execFileSync, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";


const WS_PORT = process.env.SQUAWK_WS_PORT ?? "25147";
const CHAT = "http://127.0.0.1:25120";
const KAFKA_BIN = "/usr/share/kafka/bin";
const TOPIC = "spine.events";
const SELF = process.env.SPINE_AGENT ?? "tau";

function token(): string {
	return fs.readFileSync(path.join(os.homedir(), ".config", "estate-chat-token"), "utf8").trim();
}
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

function kafkaProduce(text: string): boolean {
	try {
		execFileSync(
			`${KAFKA_BIN}/kafka-console-producer.sh`,
			["--bootstrap-server", "127.0.0.1:25144", "--topic", TOPIC],
			{ input: text, timeout: 15000, stdio: ["pipe", "ignore", "pipe"] },
		);
		return true;
	} catch (e) {
		console.error(`[spine] kafka receipt failed: ${String(e).slice(0, 120)}`);
		return false;
	}
}

async function relayToRoom(room: string, from: string, body: string): Promise<void> {
	if (from === SELF) return;
	try {
		await fetch(`${CHAT}/v1/rooms/${room}/messages`, {
			method: "POST",
			headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
			body: JSON.stringify({ from_agent: `spine-relay/${from}`, body }),
		});
	} catch {}
}

async function watch(): Promise<void> {
	const ws = new WebSocket(`ws://127.0.0.1:${WS_PORT}`);
	let kafkaOk = 0;
	let kafkaFail = 0;
	ws.onopen = () => console.log(`[spine] wired to squawk-ws :${WS_PORT} — reactive, no polling`);
	ws.onmessage = async event => {
		try {
			const msg = JSON.parse(String(event.data));
			const line = JSON.stringify({ ts: msg.ts ?? new Date().toISOString(), room: msg.room ?? "fleet", from: msg.from_agent ?? msg.from, body: (msg.body ?? "").slice(0, 500) });
			// Durable receipt — fire and verify, never queue.
			if (kafkaProduce(line)) kafkaOk++; else kafkaFail++;
			console.log(`[spine] ${line.slice(0, 140)} (kafka ok=${kafkaOk} fail=${kafkaFail})`);
			await relayToRoom(String(msg.room ?? "fleet"), String(msg.from_agent ?? msg.from ?? "?"), String(msg.body ?? ""));
		} catch {
			// non-JSON frames (pings) are noise
		}
	};
	ws.onclose = () => {
		console.log("[spine] ws closed — reconnecting in 3s (event plane must not die silently)");
		setTimeout(watch, 3000);
	};
}

function log(n: number): void {
	const child = spawn(
		`${KAFKA_BIN}/kafka-console-consumer.sh`,
		["--bootstrap-server", "127.0.0.1:25144", "--topic", TOPIC, "--from-beginning", "--max-messages", String(n)],
		{ stdio: ["ignore", "inherit", "inherit"] },
	);
	child.on("exit", code => process.exitCode = code ?? 0);
}

const [, , cmd, ...rest] = process.argv;
if (cmd === "watch") await watch();
	else if (cmd === "emit") {
		const room = rest[0] ?? "fleet";
		const text = rest.slice(1).join(" ");
		// HTTP send path (estate-chat) — the WS frame shape at :25147 is not
		// the room-send API (live: posts via WS never landed; HTTP seq
		// increments). WS remains the WATCH leg.
		const res = await fetch(`${CHAT}/v1/rooms/${room}/messages`, {
			method: "POST",
			headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
			body: JSON.stringify({ from_agent: SELF, body: text }),
		});
		const out = await res.json().catch(() => ({}));
		kafkaProduce(JSON.stringify({ ts: new Date().toISOString(), room, from: SELF, body: text }));
		console.log(`[spine] emitted: ${JSON.stringify(out).slice(0, 120)}`);
	} else if (cmd === "log") log(Number(rest[0] ?? 5));
else {
	console.log("usage: spine watch | emit <room> <text> | log [n]");
	process.exit(2);
}
