import { index, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { app, id, timestamps } from "./common";

export const householdRole = app.enum("household_role", ["owner", "member"]);

/**
 * Hogar: un grupo de personas que comparte algunas cuentas (pareja, familia). Cada registro sigue
 * teniendo un dueño (`user_id`); `household_id` solo lo hace visible a los miembros (ver RLS).
 */
export const households = app.table("households", {
  id: id(),
  name: text("name").notNull(),
  createdBy: text("created_by")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  ...timestamps,
});

export const householdMembers = app.table(
  "household_members",
  {
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: householdRole("role").notNull().default("member"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.householdId, t.userId] }),
    index("household_members_user_idx").on(t.userId),
  ],
);

/** Hogar con el que se comparte el registro (opcional). Si se borra el hogar, vuelve a ser privado. */
export const householdId = () =>
  uuid("household_id").references(() => households.id, { onDelete: "set null" });
