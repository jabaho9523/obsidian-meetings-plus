import { moment } from "obsidian";
import { TimeFormat } from "../types";

export function formatMeetingTime(d: Date, format: TimeFormat): string {
	return moment(d).format(format === "12h" ? "h:mm A" : "HH:mm");
}
