export const OVERVIEW_BASE_NAME = "Meetings overview.base";

/** Bases list notes, not lines: one row per note that still has something open. */
export const OVERVIEW_BASE = `properties:
  note.open_tasks_count:
    displayName: Open tasks
  note.open_tasks:
    displayName: Tasks
  note.open_questions_count:
    displayName: Open questions
  note.open_questions:
    displayName: Questions
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
      - note.open_tasks
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
`;
