import { RRule, RRuleSet } from "rrule";

export interface RecurrenceConfig {
  frequency: "weekly" | "biweekly";
  daysOfWeek: number[]; // 0=Monday, 1=Tuesday, ..., 6=Sunday (rrule convention)
  until: Date;
}

export function buildRRule(config: RecurrenceConfig): string {
  const rule = new RRule({
    freq: RRule.WEEKLY,
    interval: config.frequency === "biweekly" ? 2 : 1,
    byweekday: config.daysOfWeek,
    until: config.until,
  });
  return rule.toString();
}

export function expandRecurrence(
  rruleString: string,
  startTime: Date,
  rangeStart?: Date,
  rangeEnd?: Date
): Date[] {
  const ruleSet = new RRuleSet();
  const rule = RRule.fromString(rruleString);

  // Adjust rule to use the event's start time
  const adjustedRule = new RRule({
    ...rule.origOptions,
    dtstart: startTime,
  });

  ruleSet.rrule(adjustedRule);

  if (rangeStart && rangeEnd) {
    return ruleSet.between(rangeStart, rangeEnd, true);
  }

  return ruleSet.all();
}

export function getRecurrenceDescription(rruleString: string): string {
  try {
    const rule = RRule.fromString(rruleString);
    return rule.toText();
  } catch {
    return "Recurring event";
  }
}
