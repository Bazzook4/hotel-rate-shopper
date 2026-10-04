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
import { useDialog } from "../../components/Dialog";

/**
 * Users and what each may open, as one grid: a row per page, grouped by
 * area like the navigation, and a column per user. A property has a handful
 * of users and a couple of dozen pages, so this way round the grid grows
 * down rather than off the right edge.
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

/** The grantable pages grouped under their areas, one row each. */
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
  const dialog = useDialog();
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

  // One column per person, in the order rights flow: the onboarding
  // default, then the admins, then the users they manage.
  const drafts = new Set(grid.drafts.map((d) => d.id));
  const stock = (r) => (drafts.has(r.id) ? r : users.find((u) => u.id === r.id));
  const groups = [
    defaultRow && { key: "default", label: "New hotels", cols: [defaultRow] },
    admins.length && { key: "admins", label: "Property admins", cols: admins.map(stock) },
    staff.length && { key: "staff", label: "Users", cols: staff.map(stock) },
  ].filter(Boolean);
  const cols = groups.flatMap((g) => g.cols);
  const COL = { minWidth: 130 };
  const plain = { textTransform: "none", letterSpacing: 0, fontWeight: 400 };

  function nameCell(col) {
    if (col.id === DEFAULT_ROW) {
      return <span className="text-xs" style={plain}>Starting rights for an onboarded admin</span>;
    }
    if (!isDraft(col.id)) {
      return (
        <span className="block truncate text-ink" style={{ ...plain, maxWidth: 160 }} title={col.email}>
          {col.email}
        </span>
      );
    }
    // Header cells do not wrap, so each box sits in its own block or the
    // two run side by side off the edge of the column.
    return (
      <div style={{ ...plain, width: 200, whiteSpace: "normal" }}>
        <div>{grid.input(col, "email", { type: "email", placeholder: "Email", autoComplete: "off" })}</div>
        <div className="mt-1">
          {grid.input(col, "password", { type: "password", placeholder: "Password", autoComplete: "new-password" })}
        </div>
      </div>
    );
  }

  function roleCell(col) {
    if (col.id === DEFAULT_ROW) return <span className="text-xs muted" style={plain}>Property admin</span>;
    if (superAdmin) return grid.select(col, "role", roleOptions);
    return <span className="text-xs muted" style={plain}>{ROLE_LABEL[roleOf(col)] || roleOf(col)}</span>;
  }

  function statusCell(col) {
    if (col.id === DEFAULT_ROW) return null;
    if (editable(col)) return grid.select(col, "status", STATUSES);
    return <span className="text-xs muted" style={plain}>{col.status}</span>;
  }

  const muted = (col) => grid.value(col, "status") === "Suspended" && !isDraft(col.id);
  const colStyle = (col) => ({
    ...COL,
    ...(isDraft(col.id) ? { background: "var(--accent-soft)" } : {}),
    ...(muted(col) ? { opacity: 0.55 } : {}),
  });

  // A property admin sees only the pages a super admin gave the property's
  // admins: a page they can never hand out is noise, not a choice.
  const areas = superAdmin
    ? AREA_COLUMNS
    : AREA_COLUMNS.map((a) => ({ ...a, pages: a.pages.filter((p) => grantable.has(p.id)) })).filter(
        (a) => a.pages.length
      );

  const pickedName = properties.find((p) => p.id === propertyId)?.name || session?.propertyName;

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
            onChange={async (e) => {
              const next = e.target.value;
              if (
                grid.count &&
                !(await dialog.confirm({ title: "Discard unsaved changes?", confirmLabel: "Discard", danger: true }))
              ) {
                return;
              }
              grid.discard();
              setPropertyId(next);
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
          {pickedName ? `${pickedName} · ` : ""}
          {superAdmin ? "— means the page is above the property admins' rights" : "Pages your super admin has not given you are not listed"}
        </span>
      </Toolbar>

      {loading ? (
        <Loading label="Loading users…" />
      ) : !propertyId ? (
        <div className="card card-pad sub">Choose a property to manage its users.</div>
      ) : (
        <>
          {!admins.length && (
            <div className="card px-4 py-2 sub">
              This property has no property admin, so its users are not capped.
            </div>
          )}
          <Grid>
            <thead>
              <tr>
                <th className="cm-sticky" rowSpan={4} style={{ minWidth: 150, verticalAlign: "bottom" }}>
                  Page
                </th>
                {groups.map((g) => (
                  <th key={g.key} colSpan={g.cols.length} className="text-center">
                    {g.label}
                  </th>
                ))}
              </tr>
              <tr>
                {cols.map((c) => (
                  <th key={c.id} style={colStyle(c)}>{nameCell(c)}</th>
                ))}
              </tr>
              <tr>
                {cols.map((c) => (
                  <th key={c.id} style={colStyle(c)}>{roleCell(c)}</th>
                ))}
              </tr>
              <tr>
                {cols.map((c) => (
                  <th key={c.id} style={colStyle(c)}>
                    <div className="flex items-center gap-1" style={plain}>
                      <div className="flex-1">{statusCell(c)}</div>
                      {editable(c) && (
                        <>
                          <button type="button" className="btn btn-ghost text-xs" title="Tick every page" onClick={() => setAll(c, true)}>
                            All
                          </button>
                          <button type="button" className="btn btn-ghost text-xs" title="Untick every page" onClick={() => setAll(c, false)}>
                            None
                          </button>
                        </>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {areas.map((area) => (
                <Fragment key={area.id}>
                  <tr className="cm-group">
                    <td className="cm-sticky font-semibold">{area.label}</td>
                    <td colSpan={cols.length} />
                  </tr>
                  {area.pages.map((page) => (
                    <tr key={page.id}>
                      <td className="cm-sticky" style={{ paddingLeft: "1.5rem" }}>{page.label}</td>
                      {cols.map((c) => {
                        const why = blocked(c, page.id);
                        return (
                          <td key={c.id} className="text-center" title={why || undefined} style={colStyle(c)}>
                            {why ? (
                              <span className="faint">—</span>
                            ) : (
                              grid.check(c, field(page.id), {
                                disabled: !editable(c),
                                "aria-label": `${page.label} for ${c.email || "new user"}`,
                              })
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </Grid>
        </>
      )}
    </div>
  );
}
