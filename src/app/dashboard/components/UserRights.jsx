"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { AREAS, GRANTABLE_MODULES } from "@/app/dashboard/modules";
import { ROLES, isSuperAdmin } from "@/lib/permissions";
import {
  Grid,
  Loading,
  Messages,
  SaveActions,
  SetupHeader,
  Toolbar,
  isDraft,
  sendJSON,
  useGrid,
} from "./SetupGrid";

/**
 * Users and what each may open, as one grid: a row per user, a column per
 * page, grouped by area like the navigation.
 *
 * Rights flow down. A super admin ticks what a property's admins hold; the
 * admins tick what their users hold, and can only tick within what the
 * admins hold between them. Pages above that are shown as a dash rather than
 * a box, so it is plain why a user cannot be given them. A super admin also
 * gets a first row: what an onboarded hotel's admin starts with.
 */

const DEFAULT_ROW = "defaults";
const field = (id) => `m_${id}`;
const STATUSES = ["Active", "Suspended"].map((s) => ({ id: s, label: s }));
const ROLE_LABEL = { [ROLES.PROPERTY_ADMIN]: "Property admin", [ROLES.PROPERTY_USER]: "User" };

/** The grantable pages grouped under their areas, for the two header rows. */
const AREA_COLUMNS = AREAS.map((a) => ({
  ...a,
  pages: GRANTABLE_MODULES.filter((m) => m.area === a.id),
})).filter((a) => a.pages.length);

const PAGE_IDS = GRANTABLE_MODULES.map((m) => m.id);

function toRow(user) {
  const row = { ...user };
  for (const id of PAGE_IDS) row[field(id)] = (user.modules || []).includes(id);
  return row;
}

const modulesOf = (row) => PAGE_IDS.filter((id) => row[field(id)]);

export default function UserRights({ session, propertyId: fixedPropertyId = null, pickProperty = false }) {
  const superAdmin = isSuperAdmin(session);
  const [properties, setProperties] = useState([]);
  const [propertyId, setPropertyId] = useState(fixedPropertyId);
  const [data, setData] = useState(null);
  const [defaults, setDefaults] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  useEffect(() => setPropertyId(fixedPropertyId), [fixedPropertyId]);

  useEffect(() => {
    if (!pickProperty || !superAdmin) return;
    fetch("/api/properties")
      .then((r) => r.json())
      .then((j) => {
        setProperties(j.properties || []);
        setPropertyId((cur) => cur || j.properties?.[0]?.id || null);
      })
      .catch(() => {});
  }, [pickProperty, superAdmin]);

  const load = useCallback(async () => {
    if (!propertyId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [users, defs] = await Promise.all([
        sendJSON(`/api/users?propertyId=${encodeURIComponent(propertyId)}`, "GET"),
        superAdmin ? sendJSON("/api/users/defaults", "GET") : null,
      ]);
      setData(users);
      setDefaults(defs?.modules || null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [propertyId, superAdmin]);

  useEffect(() => {
    load();
  }, [load]);

  const users = useMemo(() => (data?.users || []).map(toRow), [data]);
  const defaultRow = useMemo(
    () =>
      defaults
        ? toRow({ id: DEFAULT_ROW, email: "New hotels start with", modules: defaults })
        : null,
    [defaults]
  );
  const stored = useMemo(() => (defaultRow ? [defaultRow, ...users] : users), [defaultRow, users]);
  const grid = useGrid(stored);

  const all = [...users, ...grid.drafts].map((r) => grid.merged(r));
  const admins = all.filter((r) => r.role === ROLES.PROPERTY_ADMIN);
  const staff = all.filter((r) => r.role !== ROLES.PROPERTY_ADMIN);

  // Worked out from the grid as it stands, so ticking an admin's page opens
  // it up for their users before anything is saved.
  const ceiling = admins.length ? new Set(admins.flatMap(modulesOf)) : null;
  const grantable = new Set(data?.grantable || []);

  // The role as edited, since changing it moves a row above or under the cap.
  const roleOf = (row) => (row.id === DEFAULT_ROW ? ROLES.PROPERTY_ADMIN : grid.value(row, "role"));

  /** Whether `row` may be edited by whoever is signed in. */
  const editable = (row) =>
    row.id === DEFAULT_ROW || superAdmin || roleOf(row) === ROLES.PROPERTY_USER;

  /** Why a page cannot be given to `row`, or null if it can. */
  function blocked(row, pageId) {
    if (roleOf(row) === ROLES.PROPERTY_ADMIN) return null;
    if (ceiling && !ceiling.has(pageId)) return "Not in the property admins' rights";
    if (!grantable.has(pageId)) return "Not in your rights";
    return null;
  }

  function setAll(row, on) {
    for (const id of PAGE_IDS) {
      if (!blocked(row, id)) grid.change(row, field(id), on);
    }
  }

  function addUser() {
    const blank = { email: "", password: "", role: ROLES.PROPERTY_USER, status: "Active" };
    for (const id of PAGE_IDS) blank[field(id)] = false;
    grid.add(blank);
  }

  async function saveAll() {
    setBusy(true);
    setError(null);
    setNotice(null);
    const saved = grid.count;
    // Pages above the cap are never sent: a user moved under a smaller cap
    // keeps nothing they could not have been given.
    const allowed = (row) => modulesOf(row).filter((id) => !blocked(row, id));
    const errors = await grid.save({
      label: (r) => r.email || "New user",
      update: (row, changes, next) =>
        row.id === DEFAULT_ROW
          ? sendJSON("/api/users/defaults", "PUT", { modules: modulesOf(next) })
          : sendJSON("/api/users", "PATCH", {
              id: row.id,
              ...(superAdmin ? { role: next.role } : {}),
              status: next.status,
              modules: allowed(next),
            }),
      create: (d) =>
        sendJSON("/api/users", "POST", {
          email: d.email,
          password: d.password,
          role: d.role,
          status: d.status,
          propertyId,
          modules: allowed(d),
        }),
    });
    await load();
    setBusy(false);
    if (errors.length) setError(errors.join(" · "));
    else setNotice(`Saved ${saved} change${saved === 1 ? "" : "s"}.`);
  }

  const roleOptions = [ROLES.PROPERTY_ADMIN, ROLES.PROPERTY_USER].map((r) => ({
    id: r,
    label: ROLE_LABEL[r],
  }));

  function nameCell(row) {
    if (!isDraft(row.id)) {
      return (
        <td className="cm-sticky" style={{ minWidth: 150 }}>
          <span className={row.id === DEFAULT_ROW ? "font-semibold" : "text-ink"}>{row.email}</span>
        </td>
      );
    }
    return (
      <td className="cm-sticky" style={{ minWidth: 150 }}>
        {grid.input(row, "email", { type: "email", placeholder: "Email" })}
        <div className="mt-1">
          {grid.input(row, "password", { type: "password", placeholder: "Password", autoComplete: "new-password" })}
        </div>
      </td>
    );
  }

  function userRow(row) {
    const canEdit = editable(row);
    const isDefault = row.id === DEFAULT_ROW;
    return (
      <tr key={row.id} className={isDraft(row.id) ? "cm-new" : grid.value(row, "status") === "Suspended" ? "cm-muted" : ""}>
        {nameCell(row)}
        <td>
          {isDefault ? (
            <span className="text-xs muted">Property admin</span>
          ) : superAdmin ? (
            grid.select(row, "role", roleOptions)
          ) : (
            <span className="text-xs muted">{ROLE_LABEL[roleOf(row)] || roleOf(row)}</span>
          )}
        </td>
        <td>
          {isDefault ? null : canEdit ? (
            grid.select(row, "status", STATUSES)
          ) : (
            <span className="text-xs muted">{row.status}</span>
          )}
        </td>
        <td className="whitespace-nowrap">
          {canEdit && (
            <>
              <button type="button" className="btn btn-ghost text-xs" onClick={() => setAll(row, true)}>
                All
              </button>
              <button type="button" className="btn btn-ghost text-xs" onClick={() => setAll(row, false)}>
                None
              </button>
            </>
          )}
        </td>
        {PAGE_IDS.map((id) => {
          const why = blocked(row, id);
          return (
            <td key={id} className="text-center" title={why || undefined}>
              {why ? (
                <span className="faint">—</span>
              ) : (
                grid.check(row, field(id), { disabled: !canEdit, "aria-label": id })
              )}
            </td>
          );
        })}
      </tr>
    );
  }

  const groupRow = (label, hint) => (
    <tr className="cm-group">
      <td className="cm-sticky" colSpan={4}>
        <span className="font-semibold">{label}</span>
        {hint && <span className="ml-2 text-xs muted">{hint}</span>}
      </td>
      <td colSpan={PAGE_IDS.length} />
    </tr>
  );

  const pickedName = properties.find((p) => p.id === propertyId)?.name || session?.propertyName;
  const drafts = new Set(grid.drafts.map((d) => d.id));

  return (
    <div className="space-y-4">
      <SetupHeader
        title="Users & rights"
        count={users.length}
        sub={
          superAdmin
            ? "Tick what each property admin may open. Their users can be given those pages and no others."
            : "Tick what each of your users may open. You can give any page your property admins hold."
        }
      >
        <SaveActions count={grid.count} busy={busy} onSave={saveAll} onDiscard={grid.discard} />
      </SetupHeader>

      <Messages error={error} notice={notice} />

      <Toolbar>
        <button type="button" className="btn btn-secondary text-sm" onClick={addUser} disabled={!propertyId}>
          + Add user
        </button>
        {pickProperty && superAdmin && (
          <select
            className="input w-auto text-sm"
            value={propertyId || ""}
            onChange={(e) => {
              if (grid.count && !window.confirm("Discard unsaved changes?")) return;
              grid.discard();
              setPropertyId(e.target.value);
            }}
          >
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
        <span className="ml-auto text-xs muted">
          {pickedName ? `${pickedName} · ` : ""}— means the page is above the property admins&apos; rights
        </span>
      </Toolbar>

      {loading ? (
        <Loading label="Loading users…" />
      ) : !propertyId ? (
        <div className="card card-pad sub">Choose a property to manage its users.</div>
      ) : (
        <Grid>
          <thead>
            <tr>
              <th className="cm-sticky" rowSpan={2}>User</th>
              <th rowSpan={2}>Role</th>
              <th rowSpan={2}>Status</th>
              <th rowSpan={2} />
              {AREA_COLUMNS.map((a) => (
                <th key={a.id} colSpan={a.pages.length} className="text-center">
                  {a.label}
                </th>
              ))}
            </tr>
            <tr>
              {AREA_COLUMNS.map((a) =>
                a.pages.map((p) => (
                  <th key={p.id} className="text-center" style={{ fontSize: "0.65rem" }}>
                    {p.label}
                  </th>
                ))
              )}
            </tr>
          </thead>
          <tbody>
            {defaultRow && (
              <>
                {groupRow("Onboarding default", "what a hotel's admin gets when they sign up by link")}
                {userRow(defaultRow)}
              </>
            )}
            {groupRow(
              "Property admins",
              superAdmin ? "set by super admin" : "set by your super admin — read only"
            )}
            {admins.length ? (
              admins.map((r) => (
                <Fragment key={r.id}>{userRow(drafts.has(r.id) ? r : users.find((u) => u.id === r.id))}</Fragment>
              ))
            ) : (
              <tr>
                <td colSpan={4 + PAGE_IDS.length} className="cm-empty">
                  No property admin — users here are not capped.
                </td>
              </tr>
            )}
            {groupRow("Users", "within the property admins' rights")}
            {staff.length ? (
              staff.map((r) => (
                <Fragment key={r.id}>{userRow(drafts.has(r.id) ? r : users.find((u) => u.id === r.id))}</Fragment>
              ))
            ) : (
              <tr>
                <td colSpan={4 + PAGE_IDS.length} className="cm-empty">
                  No users yet.
                </td>
              </tr>
            )}
          </tbody>
        </Grid>
      )}
    </div>
  );
}
