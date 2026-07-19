import { setIcon } from "obsidian";
import { moment } from "../../util/time";

const DAY_NAMES = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

export interface DatePickerOptions {
	/** Element to anchor the popup under (the date label button). */
	anchor: HTMLElement;
	/** YYYY-MM-DD currently focused in the agenda. */
	focusedDay: string;
	/** YYYY-MM-DD of real today. */
	today: string;
	/** Earliest selectable day (today − look-back window), YYYY-MM-DD. */
	minDay: string;
	/** Day keys (YYYY-MM-DD) that have at least one meeting. */
	daysWithMeetings: Set<string>;
	onPick: (key: string) => void;
}

export class DatePicker {
	private el: HTMLElement | null = null;
	private monthStart: Date;
	private outsideHandler: ((e: MouseEvent) => void) | null = null;
	private keyHandler: ((e: KeyboardEvent) => void) | null = null;

	constructor(private opts: DatePickerOptions) {
		const focused = dateFromKey(opts.focusedDay);
		this.monthStart = new Date(focused.getFullYear(), focused.getMonth(), 1);
	}

	isOpen(): boolean {
		return this.el !== null;
	}

	toggle(): void {
		if (this.el) this.close();
		else this.open();
	}

	private get doc(): Document {
		return this.opts.anchor.ownerDocument;
	}

	open(): void {
		if (this.el) return;
		const popup = this.doc.body.createDiv({
			cls: "meetings-plus-picker",
		});
		this.el = popup;
		this.position();
		this.render();

		this.outsideHandler = (e: MouseEvent) => {
			if (!this.el) return;
			const target = e.target as Node | null;
			if (!target) return;
			if (this.el.contains(target) || this.opts.anchor.contains(target)) {
				return;
			}
			this.close();
		};
		this.keyHandler = (e: KeyboardEvent) => {
			if (e.key === "Escape") this.close();
		};
		// Defer so the same click that opened it doesn't immediately close it.
		window.setTimeout(() => {
			if (this.outsideHandler) {
				this.doc.addEventListener("mousedown", this.outsideHandler);
			}
			if (this.keyHandler) {
				this.doc.addEventListener("keydown", this.keyHandler);
			}
		}, 0);
	}

	close(): void {
		if (this.outsideHandler) {
			this.doc.removeEventListener("mousedown", this.outsideHandler);
			this.outsideHandler = null;
		}
		if (this.keyHandler) {
			this.doc.removeEventListener("keydown", this.keyHandler);
			this.keyHandler = null;
		}
		this.el?.remove();
		this.el = null;
	}

	private position(): void {
		if (!this.el) return;
		const r = this.opts.anchor.getBoundingClientRect();
		const popupWidth = 252;
		let left = r.left;
		// Clamp inside viewport
		if (left + popupWidth > window.innerWidth - 8) {
			left = Math.max(8, window.innerWidth - popupWidth - 8);
		}
		this.el.addClass("meetings-plus-picker-floating");
		this.el.style.setProperty("--mp-picker-left", `${left}px`);
		this.el.style.setProperty("--mp-picker-top", `${r.bottom + 4}px`);
	}

	private render(): void {
		if (!this.el) return;
		this.el.empty();

		// Header: prev / month-year / next
		const header = this.el.createDiv({ cls: "meetings-plus-picker-header" });
		const prev = header.createEl("button", {
			cls: "meetings-plus-picker-nav",
			attr: { "aria-label": "Previous month" },
		});
		setIcon(prev, "chevron-left");
		prev.addEventListener("click", () => {
			this.monthStart = new Date(
				this.monthStart.getFullYear(),
				this.monthStart.getMonth() - 1,
				1
			);
			this.render();
		});

		header.createSpan({
			cls: "meetings-plus-picker-month",
			text: moment(this.monthStart).format("MMMM YYYY"),
		});

		const next = header.createEl("button", {
			cls: "meetings-plus-picker-nav",
			attr: { "aria-label": "Next month" },
		});
		setIcon(next, "chevron-right");
		next.addEventListener("click", () => {
			this.monthStart = new Date(
				this.monthStart.getFullYear(),
				this.monthStart.getMonth() + 1,
				1
			);
			this.render();
		});

		// Day-name row (Mon-first)
		const names = this.el.createDiv({ cls: "meetings-plus-picker-daynames" });
		for (const n of DAY_NAMES) {
			names.createSpan({
				cls: "meetings-plus-picker-dayname",
				text: n,
			});
		}

		// 6-week grid
		const grid = this.el.createDiv({ cls: "meetings-plus-picker-grid" });
		const firstDow = this.monthStart.getDay(); // 0=Sun
		const mondayOffset = (firstDow + 6) % 7;
		const gridStart = new Date(this.monthStart);
		gridStart.setDate(this.monthStart.getDate() - mondayOffset);

		const focusedKey = this.opts.focusedDay;
		const todayKey = this.opts.today;

		for (let i = 0; i < 42; i++) {
			const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
			const k = keyFromDate(d);
			const inMonth = d.getMonth() === this.monthStart.getMonth();
			const cell = grid.createEl("button", {
				cls: "meetings-plus-picker-cell",
				text: String(d.getDate()),
			});
			if (!inMonth) cell.addClass("meetings-plus-picker-other-month");
			if (k === todayKey) cell.addClass("meetings-plus-picker-today");
			if (k === focusedKey) cell.addClass("meetings-plus-picker-focused");
			if (this.opts.daysWithMeetings.has(k)) {
				cell.addClass("meetings-plus-picker-hasevents");
			}
			if (k < this.opts.minDay) {
				cell.setAttribute("disabled", "true");
				continue;
			}
			if (k < todayKey) {
				cell.addClass("meetings-plus-picker-past");
			}
			cell.addEventListener("click", () => {
				this.opts.onPick(k);
				this.close();
			});
		}
	}
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
