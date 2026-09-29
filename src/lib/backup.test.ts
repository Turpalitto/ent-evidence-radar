import { describe, it, expect, vi } from "vitest";
import { exportUserData } from "./backup";

vi.mock("@/db", () => {
  const dummyArticles = [
    {
      pmid: "12345",
      doi: "10.1001/jama.2024.1",
      nctId: null,
      title: "Test Article",
      notes: "Important note",
      isBookmarked: true,
      isRead: true,
    },
  ];
  const dummyTopics = [
    {
      id: 1,
      name: "Ринология",
      subspecialty: "rhinology",
      query: "rhinology",
      enabled: true,
      isDefault: true,
    },
  ];

  return {
    db: {
      select: vi.fn(() => ({
        from: vi.fn((tbl) => {
          const res = Object.assign(Promise.resolve(dummyTopics), {
            where: vi.fn(() => Promise.resolve(dummyArticles)),
            then: (resolve: (v: unknown) => unknown) => Promise.resolve(dummyTopics).then(resolve),
          });
          return res;
        }),
      })),
    },
  };
});

vi.mock("@/lib/refresh", () => {
  return {
    getSettings: vi.fn(async () => ({
      lookbackDays: 30,
      autoRefreshEnabled: true,
    })),
  };
});

describe("exportUserData", () => {
  it("exports structured user backup payload", async () => {
    const data = await exportUserData();
    expect(data.version).toBe(1);
    expect(data.bookmarksAndNotes).toHaveLength(1);
    expect(data.bookmarksAndNotes[0].pmid).toBe("12345");
    expect(data.bookmarksAndNotes[0].notes).toBe("Important note");
    expect(data.topics).toHaveLength(1);
    expect(data.topics[0].name).toBe("Ринология");
    expect(data.settings).toHaveProperty("lookbackDays", 30);
  });
});
