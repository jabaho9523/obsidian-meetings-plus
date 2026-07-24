import { moment as obsidianMoment } from "obsidian";
import { TimeFormat } from "../types";

interface MomentLike {
	format(fmt?: string): string;
	fromNow(): string;
}

/**
 * Obsidian re-exports moment, but the export resolves as `any` when the
 * moment type declarations aren't available to the type checker. This
 * narrow facade keeps every call site fully typed.
 */
export const moment = obsidianMoment as unknown as (
	input?: Date | number | string
) => MomentLike;

export function formatMeetingTime(d: Date, format: TimeFormat): string {
	return moment(d).format(format === "12h" ? "h:mm a" : "HH:mm");
}
