declare module "ical.js" {
	interface ICALTime {
		toJSDate(): Date;
		isDate: boolean;
		clone(): ICALTime;
		compare(other: ICALTime): number;
		convertToZone(zone: ICALTimezone): ICALTime;
	}

	interface ICALTimezone {
		tzid: string;
	}

	interface ICALDuration {
		toSeconds(): number;
	}

	interface ICALProperty {
		name: string;
		getFirstValue(): unknown;
		getValues(): unknown[];
		getParameter(name: string): string | string[] | undefined;
	}

	interface ICALComponent {
		name: string;
		getAllSubcomponents(name: string): ICALComponent[];
		hasProperty(name: string): boolean;
		getFirstSubcomponent(name: string): ICALComponent | null;
		getAllProperties(name?: string): ICALProperty[];
		getFirstProperty(name: string): ICALProperty | null;
		getFirstPropertyValue<T = unknown>(name: string): T | null;
	}

	interface ICALEventOccurrence {
		startDate: ICALTime;
		endDate: ICALTime;
		recurrenceId?: ICALTime;
		item: ICALEvent;
	}

	interface ICALEvent {
		uid: string;
		summary: string;
		location: string;
		description: string;
		organizer: string;
		startDate: ICALTime;
		endDate: ICALTime;
		duration: ICALDuration;
		isRecurring(): boolean;
		iterator(start?: ICALTime): ICALRecurExpansion;
		getOccurrenceDetails(time: ICALTime): ICALEventOccurrence;
		component: ICALComponent;
		attendees: ICALProperty[];
	}

	interface ICALRecurExpansion {
		next(): ICALTime | null;
	}

	interface ICALStatic {
		parse(input: string): unknown;
		Component: new (jcal: unknown) => ICALComponent;
		Event: new (component: ICALComponent) => ICALEvent;
		Time: {
			fromJSDate(date: Date, useUTC?: boolean): ICALTime;
			fromString(str: string): ICALTime;
		};
		TimezoneService: {
			has(tzid: string): boolean;
			register(component: ICALComponent): void;
		};
	}

	const ICAL: ICALStatic;
	export default ICAL;
}
