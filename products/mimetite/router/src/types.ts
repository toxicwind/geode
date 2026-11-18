/**
 * Core message/tool/context types for the dialect system.
 *
 * Ported from tau packages/ai/src/types.ts (the subset the dialect pipeline
 * consumes). Provider-native metadata payloads are kept as opaque optional
 * fields — the dialect only reads the structural fields (role, content,
 * toolCallId, toolName, isError, etc.).
 */

import type { Tool } from "./utils/schema/wire";

export type MessageAttribution = "user" | "agent";

export interface TextContent {
	type: "text";
	text: string;
	textSignature?: string;
}

export interface ThinkingContent {
	type: "thinking";
	thinking: string;
	thinkingSignature?: string;
	itemId?: string;
	summary?: boolean;
	narration?: boolean;
}

export interface RedactedThinkingContent {
	type: "redactedThinking";
	data: string;
}

export interface AnthropicFallbackContent {
	type: "fallback";
	from: { model: string };
	to: { model: string };
}

export interface AnthropicServerToolContent {
	type: "anthropicServerTool";
	block: Record<string, unknown>;
}

export interface ProviderFileReference {
	provider: "openai" | "anthropic" | "google";
	id?: string;
	uri?: string;
	expiresAt?: number;
}

export interface ImageContent {
	type: "image";
	data: string;
	mimeType: string;
	detail?: "auto" | "low" | "high" | "original";
	providerFile?: ProviderFileReference;
	url?: string;
}

export type ProviderPayload = Record<string, unknown>;

export interface ToolCall {
	type: "toolCall";
	id: string;
	name: string;
	arguments: Record<string, unknown>;
	thoughtSignature?: string;
	intent?: string;
	rawBlock?: string;
	customWireName?: string;
	providerMetadata?: Record<string, unknown>;
}

export type StopReason = "stop" | "length" | "toolUse" | "error" | "aborted";

export interface Usage {
	inputTokens?: number;
	outputTokens?: number;
	totalTokens?: number;
	[key: string]: unknown;
}

export interface StopDetails {
	reason?: string;
	[key: string]: unknown;
}

export interface ContextSnapshot {
	promptTokens: number;
	nonMessageTokens: number;
	historyRewriteTokensRemoved?: number;
	compactionEpoch?: number;
	lastMessageTimestamp?: number;
}

export interface AssistantRetryRecovery {
	kind: string;
	status: string;
	[key: string]: unknown;
}

export interface AssistantMessage {
	role: "assistant";
	content: (
		| TextContent
		| ThinkingContent
		| RedactedThinkingContent
		| AnthropicFallbackContent
		| AnthropicServerToolContent
		| ImageContent
		| ToolCall
	)[];
	api: string;
	provider: string;
	model: string;
	credentialId?: number;
	contextSnapshot?: ContextSnapshot;
	retryRecovery?: AssistantRetryRecovery;
	responseId?: string;
	upstreamProvider?: string;
	upstreamModel?: string;
	messageReasoningDetails?: unknown[];
	usage: Usage;
	stopReason: StopReason;
	stopDetails?: StopDetails | null;
	errorMessage?: string;
	errorClassificationMessage?: string;
	requestBodyReadTimeoutFullReplay?: boolean;
	toolCallAbortMessages?: Record<string, string>;
	errorStatus?: number;
	errorId?: number;
	disabledFeatures?: string[];
	inputTransformations?: unknown[];
	requestControls?: Record<string, unknown>;
	providerPayload?: ProviderPayload;
	timestamp: number;
	duration?: number;
	ttft?: number;
	completedAt?: number;
}

export interface ToolResultMessage<TDetails = unknown> {
	role: "toolResult";
	toolCallId: string;
	toolName: string;
	content: (TextContent | ImageContent)[];
	details?: TDetails;
	isError: boolean;
	attribution?: MessageAttribution;
	prunedAt?: number;
	providerMetadata?: Record<string, unknown>;
	useless?: boolean;
	timestamp: number;
}

export interface UserMessage {
	role: "user";
	content: string | (TextContent | ImageContent)[];
	synthetic?: boolean;
	steering?: boolean;
	historyRewriteAt?: number;
	attribution?: MessageAttribution;
	providerPayload?: ProviderPayload;
	timestamp: number;
}

export interface DeveloperMessage {
	role: "developer";
	content: string | (TextContent | ImageContent)[];
	attribution?: MessageAttribution;
	synthetic?: boolean;
	userInitiated?: boolean;
	providerPayload?: ProviderPayload;
	timestamp: number;
}

export type Message = UserMessage | DeveloperMessage | AssistantMessage | ToolResultMessage;

export interface Context {
	systemPrompt?: string[];
	messages: Message[];
	tools?: Tool[];
	inactiveTools?: Tool[];
}

/**
 * Streaming event emitted by an {@link AssistantMessageEventStream} while an
 * assistant message is being produced incrementally. Ported from tau
 * `packages/ai/src/types.ts`.
 */
export type AssistantMessageEvent =
	| { type: "start"; contentIndex?: undefined; partial: AssistantMessage }
	| { type: "text_start"; contentIndex: number; partial: AssistantMessage }
	| { type: "text_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
	| { type: "text_end"; contentIndex: number; content: string; partial: AssistantMessage }
	| { type: "thinking_start"; contentIndex: number; partial: AssistantMessage }
	| { type: "thinking_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
	| { type: "thinking_end"; contentIndex: number; content: string; partial: AssistantMessage }
	| { type: "image_end"; contentIndex: number; content: ImageContent; partial: AssistantMessage }
	| { type: "toolcall_start"; contentIndex: number; partial: AssistantMessage }
	| { type: "toolcall_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
	| { type: "toolcall_end"; contentIndex: number; toolCall: ToolCall; partial: AssistantMessage }
	| {
			type: "done";
			contentIndex?: undefined;
			reason: Extract<StopReason, "stop" | "length" | "toolUse">;
			message: AssistantMessage;
	  }
	| {
			type: "error";
			contentIndex?: undefined;
			reason: Extract<StopReason, "aborted" | "error">;
			error: AssistantMessage;
	  };
