export const OVERVIEW_BASE_NAME = "Meetings overview.base";

/** Bases list notes, not lines: one row per note that still has something open. */
export const OVERVIEW_BASE = `properties:
  note.open_tasks_count:
    displayName: Open tasks
  note.open_questions_count:
    displayName: Open questions
  note.open_questions:
    displayName: Questions
  note.things_count:
    displayName: In Things
views:
  - type: table
    name: Open tasks
    filters:
      and:
        - "note.open_tasks_count > 0"
    order:
      - file.name
      - note.date
      - note.open_tasks_count
  - type: table
    name: Open questions
    filters:
      and:
        - "note.open_questions_count > 0"
    order:
      - file.name
      - note.date
      - note.open_questions_count
      - note.open_questions
  - type: table
    name: Sent to Things
    filters:
      and:
        - "note.things_count > 0"
    order:
      - file.name
      - note.date
      - note.things_count
`;
