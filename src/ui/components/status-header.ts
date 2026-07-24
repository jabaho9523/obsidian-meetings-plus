import { setIcon } from "obsidian";
import { moment } from "../../util/time";
import { CalendarConfig, CalendarStatus } from "../../types";
import { DatePicker } from "./date-picker";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DAYS = 180;

export interface StatusHeaderOptions {
	parent: HTMLElement;
	calendars: CalendarConfig[];
	statuses: CalendarStatus[];
	lookAheadDays: number;
	/** YYYY-MM-DD currently focused */
	focusedDay: string;
	/** YYYY-MM-DD of today */
	today: string;
	/** Earliest navigable day (today − lookBackDays), YYYY-MM-DD */
	minDay: string;
	/** Set of day keys that have at least one meeting (for picker dots) */
	daysWithMeetings: Set<string>;
	onRefresh: () => void;
	onOpenSettings: () => void;
	onPickDay: (key: string) => void;
	onChangeDays: (n: number) => void;
}

export function renderStatusHeader(opts: StatusHeaderOptions): void {
	const root = opts.parent.createDiv({ cls: "meetings-plus-status" });

	const top = root.createDiv({ cls: "meetings-plus-status-top" });
	const left = top.createDiv({ cls: "meetings-plus-status-left" });
	left.createDiv({
		cls: "meetings-plus-status-title",
		text: moment().format("dddd, MMM D"),
	});
	left.createDiv({
		cls: "meetings-plus-status-sub",
		text: summarizeStatus(opts.statuses),
	});

	const actions = top.createDiv({ cls: "meetings-plus-status-actions" });
	const refresh = actions.createEl("button", {
		cls: "meetings-plus-icon-btn",
		attr: { "aria-label": "Refresh calendars" },
	});
	setIcon(refresh, "refresh-cw");
	refresh.addEventListener("click", () => opts.onRefresh());

	const settings = actions.createEl("button", {
		cls: "meetings-plus-icon-btn",
		attr: { "aria-label": "Open plugin settings" },
	});
	setIcon(settings, "settings");
	settings.addEventListener("click", () => opts.onOpenSettings());

	renderDateBar(root, opts);
}

function renderDateBar(parent: HTMLElement, opts: StatusHeaderOptions): void {
	const focusedDate = dateFromKey(opts.focusedDay);

	const bar = parent.createDiv({ cls: "meetings-plus-datebar" });

	const prev = bar.createEl("button", {
		cls: "meetings-plus-icon-btn",
		attr: { "aria-label": "Previous day" },
	});
	setIcon(prev, "chevron-left");
	if (opts.focusedDay <= opts.minDay) prev.setAttribute("disabled", "true");
	prev.addEventListener("click", () => {
		if (opts.focusedDay <= opts.minDay) return;
		const next = new Date(focusedDate.getTime() - DAY_MS);
		opts.onPickDay(keyFromDate(next));
	});

	const label = bar.createEl("button", {
		cls: "meetings-plus-datebar-label",
		text: labelFor(focusedDate, opts.today),
	});

	let picker: DatePicker | null = null;
	label.addEventListener("click", () => {
		if (picker?.isOpen()) {
			picker.close();
			picker = null;
			return;
		}
		picker = new DatePicker({
			anchor: label,
			focusedDay: opts.focusedDay,
			today: opts.today,
			minDay: opts.minDay,
			daysWithMeetings: opts.daysWithMeetings,
			onPick: (k) => opts.onPickDay(k),
		});
		picker.open();
	});

	const next = bar.createEl("button", {
		cls: "meetings-plus-icon-btn",
		attr: { "aria-label": "Next day" },
	});
	setIcon(next, "chevron-right");
	next.addEventListener("click", () => {
		const np = new Date(focusedDate.getTime() + DAY_MS);
		opts.onPickDay(keyFromDate(np));
	});

	renderDaysPill(bar, opts);

	if (opts.focusedDay !== opts.today) {
		const todayBtn = bar.createEl("button", {
			cls: "meetings-plus-datebar-today",
			text: "Today",
		});
		todayBtn.addEventListener("click", () => opts.onPickDay(opts.today));
	}
}

function renderDaysPill(bar: HTMLElement, opts: StatusHeaderOptions): void {
	const pill = bar.createEl("button", {
		cls: "meetings-plus-datebar-days",
		text: `${opts.lookAheadDays}d`,
		attr: { "aria-label": "Days shown" },
	});
	pill.addEventListener("click", () => {
		const input = bar.createEl("input", {
			cls: "meetings-plus-datebar-days-input",
			attr: {
				type: "number",
				min: "1",
				max: String(MAX_DAYS),
				value: String(opts.lookAheadDays),
				"aria-label": "Days to show",
			},
		});
		pill.replaceWith(input);
		input.focus();
		input.select();

		let committed = false;
		const commit = () => {
			if (committed) return;
			committed = true;
			const n = parseInt(input.value, 10);
			if (Number.isFinite(n) && n >= 1 && n <= MAX_DAYS) {
				if (n !== opts.lookAheadDays) opts.onChangeDays(n);
				else input.replaceWith(pill);
			} else {
				input.replaceWith(pill);
			}
		};
		const cancel = () => {
			if (committed) return;
			committed = true;
			input.replaceWith(pill);
		};
		input.addEventListener("blur", commit);
		input.addEventListener("keydown", (evt) => {
			if (evt.key === "Enter") {
				evt.preventDefault();
				commit();
			} else if (evt.key === "Escape") {
				evt.preventDefault();
				cancel();
			}
		});
	});
}

function labelFor(d: Date, todayKey: string): string {
	const k = keyFromDate(d);
	if (k === todayKey) return moment(d).format("[Today] · ddd, MMM D");
	return moment(d).format("ddd, MMM D");
}

function dateFromKey(k: string): Date {
	const [y, m, d] = k.split("-").map((x) => parseInt(x, 10));
	return new Date(y!, (m ?? 1) - 1, d ?? 1);
}

function keyFromDate(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const dd = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${dd}`;
}

function summarizeStatus(statuses: CalendarStatus[]): string {
	if (statuses.length === 0) return "No calendars yet";
	const errors = statuses.filter((s) => s.status.kind === "error");
	if (errors.length > 0) {
		return errors.length === 1
			? `One calendar failed to fetch`
			: `${errors.length} calendars failed to fetch`;
	}
	const fetching = statuses.some((s) => s.status.kind === "fetching");
	if (fetching) return "Fetching…";
	const last = statuses
		.map((s) =>
			s.status.kind === "success" ? s.status.fetchedAt : 0
		)
		.reduce((a, b) => Math.max(a, b), 0);
	if (last === 0) return "Not fetched yet";
	return `Last fetched ${moment(last).fromNow()}`;
}
