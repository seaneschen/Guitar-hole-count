import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const EMPTY_STATE = Object.freeze({
  counts: {},
  updatedAt: null,
  revision: 0,
});

function cleanLabel(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function copyEmptyState() {
  return { counts: {}, updatedAt: null, revision: 0 };
}

function normalizeStoredState(value) {
  if (!value || typeof value !== "object") return copyEmptyState();

  // Accept the original prototype's array shape so an existing state file can
  // be upgraded without losing the current morning snapshot.
  const sourceCounts =
    value.counts && typeof value.counts === "object" && !Array.isArray(value.counts)
      ? Object.entries(value.counts).map(([label, count]) => ({ label, ...count }))
      : Array.isArray(value.items)
        ? value.items
        : [];

  const counts = {};
  for (const entry of sourceCounts) {
    const label = cleanLabel(entry?.label);
    const starting = Number(entry?.starting);
    const remaining = Number(entry?.remaining);
    if (
      !label ||
      !Number.isInteger(starting) ||
      !Number.isInteger(remaining) ||
      starting < 0 ||
      remaining < 0 ||
      remaining > starting
    ) {
      continue;
    }
    counts[label] = { starting, remaining };
  }

  return {
    counts,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : null,
    revision: Number.isInteger(value.revision) && value.revision >= 0 ? value.revision : 0,
  };
}

function findStoredLabel(state, requestedLabel) {
  const target = cleanLabel(requestedLabel).toLocaleLowerCase();
  return Object.keys(state.counts).find(
    (label) => label.toLocaleLowerCase() === target
  );
}

export function toSnapshot(state) {
  const safe = normalizeStoredState(state);
  const rows = Object.entries(safe.counts).map(([label, count]) => ({
    label,
    starting: count.starting,
    remaining: count.remaining,
    brokenOut: count.starting - count.remaining,
  }));

  const totals = rows.reduce(
    (total, row) => ({
      starting: total.starting + row.starting,
      remaining: total.remaining + row.remaining,
      brokenOut: total.brokenOut + row.brokenOut,
    }),
    { starting: 0, remaining: 0, brokenOut: 0 }
  );

  return {
    initialized: rows.length > 0,
    rows,
    totals,
    updatedAt: safe.updatedAt,
    revision: safe.revision,
  };
}

export class HoleCountStore {
  #mutationTail = Promise.resolve();

  constructor({ dataDir = process.env.DATA_DIR || path.resolve("data") } = {}) {
    this.dataDir = path.resolve(dataDir);
    this.statePath = path.join(this.dataDir, "state.json");
    this.backupPath = path.join(this.dataDir, "state.backup.json");
  }

  async #readStateFile() {
    try {
      return normalizeStoredState(JSON.parse(await readFile(this.statePath, "utf8")));
    } catch (error) {
      try {
        return normalizeStoredState(JSON.parse(await readFile(this.backupPath, "utf8")));
      } catch (backupError) {
        if (error?.code === "ENOENT" && backupError?.code === "ENOENT") {
          return copyEmptyState();
        }
        throw error;
      }
    }
  }

  async readState() {
    await this.#mutationTail;
    return this.#readStateFile();
  }

  async #writeState(next) {
    await mkdir(this.dataDir, { recursive: true });
    const safe = normalizeStoredState(next);
    const tempPath = `${this.statePath}.${process.pid}.tmp`;
    const backupTempPath = `${this.backupPath}.${process.pid}.tmp`;
    const serialized = `${JSON.stringify(safe, null, 2)}\n`;
    await writeFile(tempPath, serialized, "utf8");
    await rename(tempPath, this.statePath);
    try {
      await writeFile(backupTempPath, serialized, "utf8");
      await rename(backupTempPath, this.backupPath);
    } catch {
      // The authoritative write already succeeded. A stale redundancy copy is
      // preferable to reporting failure after committing the mutation.
    }
    return safe;
  }

  #mutate(operation) {
    const result = this.#mutationTail.then(operation);
    this.#mutationTail = result.catch(() => undefined);
    return result;
  }

  async snapshot() {
    return toSnapshot(await this.readState());
  }

  setMorningCount(entries) {
    return this.#mutate(async () => {
      if (!Array.isArray(entries) || entries.length === 0) {
        throw new Error("Enter at least one brand or category.");
      }

      const counts = {};
      const seen = new Set();
      for (const entry of entries) {
        const label = cleanLabel(entry?.label);
        const count = Number(entry?.count);
        if (!label) throw new Error("Every row needs a brand or category.");
        if (!Number.isInteger(count) || count < 0) {
          throw new Error(`Count for ${label} must be a whole number of 0 or more.`);
        }
        const key = label.toLocaleLowerCase();
        if (seen.has(key)) throw new Error(`Duplicate label: ${label}.`);
        seen.add(key);
        counts[label] = { starting: count, remaining: count };
      }

      const current = await this.#readStateFile();
      return this.#writeState({
        counts,
        updatedAt: new Date().toISOString(),
        revision: current.revision + 1,
      });
    });
  }

  breakOut(entries) {
    return this.#mutate(async () => {
      if (!Array.isArray(entries) || entries.length === 0) {
        throw new Error("Provide at least one guitar breakout.");
      }

      const state = await this.#readStateFile();
      if (Object.keys(state.counts).length === 0) {
        throw new Error("Enter a morning hole count first.");
      }

      const totalsByLabel = new Map();
      for (const entry of entries) {
        const quantity = Number(entry?.quantity);
        if (!Number.isInteger(quantity) || quantity < 1) {
          throw new Error("Each breakout quantity must be a whole number of 1 or more.");
        }
        const storedLabel = findStoredLabel(state, entry?.label);
        if (!storedLabel) {
          throw new Error(`No current row named “${cleanLabel(entry?.label)}”.`);
        }
        totalsByLabel.set(storedLabel, (totalsByLabel.get(storedLabel) ?? 0) + quantity);
      }

      // Validate the whole batch before changing anything so multi-category
      // requests either fully succeed or leave the snapshot untouched.
      for (const [label, quantity] of totalsByLabel) {
        const remaining = state.counts[label].remaining;
        if (quantity > remaining) {
          throw new Error(
            `${label} only has ${remaining} hole${remaining === 1 ? "" : "s"} remaining.`
          );
        }
      }

      for (const [label, quantity] of totalsByLabel) {
        state.counts[label].remaining -= quantity;
      }
      state.updatedAt = new Date().toISOString();
      state.revision += 1;
      return this.#writeState(state);
    });
  }

  adjustBalance(entries) {
    return this.#mutate(async () => {
      if (!Array.isArray(entries) || entries.length === 0) {
        throw new Error("Provide at least one balance adjustment.");
      }

      const state = await this.#readStateFile();
      if (Object.keys(state.counts).length === 0) {
        throw new Error("Enter a morning hole count first.");
      }

      const totalsByLabel = new Map();
      for (const entry of entries) {
        const delta = Number(entry?.delta);
        if (!Number.isInteger(delta) || delta === 0) {
          throw new Error("Each adjustment must be a non-zero whole number.");
        }
        const storedLabel = findStoredLabel(state, entry?.label);
        if (!storedLabel) {
          throw new Error(`No current row named “${cleanLabel(entry?.label)}”.`);
        }
        totalsByLabel.set(storedLabel, (totalsByLabel.get(storedLabel) ?? 0) + delta);
      }

      for (const [label, delta] of totalsByLabel) {
        const count = state.counts[label];
        const nextRemaining = count.remaining + delta;
        if (nextRemaining < 0 || nextRemaining > count.starting) {
          throw new Error(
            `${label} must stay between 0 and its morning count of ${count.starting}.`
          );
        }
      }

      for (const [label, delta] of totalsByLabel) {
        state.counts[label].remaining += delta;
      }
      state.updatedAt = new Date().toISOString();
      state.revision += 1;
      return this.#writeState(state);
    });
  }
}

export { EMPTY_STATE };
