import type { ItemDetail, PriceObservation } from "@grocery/shared";
// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "../../../stores/auth-store";
import { stubImagePipeline, stubObjectUrls } from "../../../test/image-stub";
import { createApiFetchMock, json } from "../../../test/mock-api";
import { ItemDetailsPage } from "./item-details-page";
import "../../../test/setup";

const { uPlotCtor } = vi.hoisted(() => ({
  uPlotCtor: vi.fn((_opts: unknown, _data: unknown, _target: unknown) => ({
    destroy: vi.fn(),
  })),
}));
// jsdom cannot rasterize — the chart's data/legend logic is asserted via this mock.
vi.mock("uplot", () => ({ default: uPlotCtor }));

const USER = { id: "u1", email: "alex@example.com", role: "admin" } as const;
const CATEGORIES = [
  { id: "c1", title: "Other", color: "#6B7280", sortOrder: 0, itemCount: 1 },
  { id: "c2", title: "Dairy", color: "#3B82F6", sortOrder: 1, itemCount: 0 },
];
const ADDED_AT = "2026-09-24T08:00:00.000Z";
const OBSERVED_AT = "2026-09-25T10:00:00.000Z";

function observation(over: Partial<PriceObservation> = {}): PriceObservation {
  return { price: 1.99, shop: "Lidl", observedAt: OBSERVED_AT, ...over };
}

function detailFixture(over: Partial<ItemDetail> = {}): ItemDetail {
  return {
    id: "i1",
    title: "Milk",
    qtyText: "2x",
    status: "TO_BUY",
    sortOrder: 0,
    addedAt: ADDED_AT,
    daysInList: 3,
    category: { id: "c1", title: "Other", color: "#6B7280" },
    imageFilename: null,
    currentPrice: null,
    prices: [],
    ...over,
  };
}

let detail: ItemDetail;

function renderPage(listId: string | null = "l1"): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={[
          { pathname: "/items/i1", state: listId === null ? undefined : { listId } },
        ]}
      >
        <Routes>
          <Route path="/items/:itemId" element={<ItemDetailsPage />} />
          <Route path="/" element={<p>lists-page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function pricePoints(): HTMLElement[] {
  return screen.getAllByTestId("price-point");
}

function chartData(): number[][] {
  const last = uPlotCtor.mock.calls.at(-1);
  if (!last) throw new Error("uPlot was never constructed");
  return last[1] as number[][];
}
beforeEach(() => {
  detail = detailFixture();
  useAuthStore.setState({ accessToken: "t", user: { ...USER } });
  uPlotCtor.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ItemDetailsPage (docs/TASKS.md → T18)", () => {
  it("renders the item fields, the category select, and its price history", async () => {
    detail = detailFixture({
      imageFilename: "i1-abc.webp",
      currentPrice: observation(),
      prices: [observation()],
    });
    const mock = createApiFetchMock();
    mock.on("GET", "/api/items/i1", () => json(200, detail));
    mock.on("GET", "/api/lists/l1/categories", () => json(200, CATEGORIES));
    mock.stub();
    renderPage();

    expect(await screen.findByDisplayValue("Milk")).toBeInTheDocument();
    expect(screen.getByDisplayValue("2x")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Category" })).toHaveValue("c1");
    expect(screen.getByRole("option", { name: "Dairy" })).toBeInTheDocument();
    expect(screen.getByTestId("item-image")).toHaveAttribute("src", "/static/i1-abc.webp");
    expect(screen.getByTestId("price-point")).toHaveTextContent("1.99");
    expect(screen.getByTestId("price-point")).toHaveTextContent("Lidl");
    expect(uPlotCtor).toHaveBeenCalledTimes(1);
    expect(chartData()[1]).toEqual([1.99]);
  });

  it("saves edits via PATCH /items/:id and shows the refreshed item", async () => {
    const mock = createApiFetchMock();
    mock.on("GET", "/api/items/i1", () => json(200, detail));
    mock.on("GET", "/api/lists/l1/categories", () => json(200, CATEGORIES));
    mock.on("PATCH", "/api/items/i1", ({ body }) => {
      const patch = body as { title: string; categoryId: string; qtyText: string | null };
      detail = {
        ...detail,
        title: patch.title,
        qtyText: patch.qtyText,
        category: CATEGORIES.find((c) => c.id === patch.categoryId) ?? detail.category,
      };
      return json(200, detail);
    });
    mock.stub();
    const user = userEvent.setup();
    renderPage();

    const title = await screen.findByLabelText("Title");
    await user.clear(title);
    await user.type(title, "Organic Milk");
    await user.selectOptions(screen.getByRole("combobox", { name: "Category" }), "c2");
    await user.clear(screen.getByLabelText("Quantity (optional)"));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(mock.callsTo("PATCH", "/api/items/i1")[0]?.body).toEqual({
        title: "Organic Milk",
        categoryId: "c2",
        qtyText: null,
      }),
    );
    expect(await screen.findByDisplayValue("Organic Milk")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Category" })).toHaveValue("c2");
  });

  it("adds a price (DoD): POST /items/:id/prices adds a point to the chart", async () => {
    detail = detailFixture({ prices: [observation()], currentPrice: observation() });
    const mock = createApiFetchMock();
    mock.on("GET", "/api/items/i1", () => json(200, detail));
    mock.on("GET", "/api/lists/l1/categories", () => json(200, CATEGORIES));
    mock.on("POST", "/api/items/i1/prices", ({ body }) => {
      const request = body as { price: number; shop: string };
      const created = observation({ price: request.price, shop: request.shop });
      detail = {
        ...detail,
        currentPrice: created,
        prices: [created, ...detail.prices],
      };
      return json(201, created);
    });
    mock.stub();
    const user = userEvent.setup();
    renderPage();

    const legendBefore = await screen.findByTestId("price-point");
    expect(legendBefore).toHaveTextContent("1.99");
    expect(uPlotCtor).toHaveBeenCalledTimes(1);

    await user.type(screen.getByLabelText("Price"), "2.5");
    await user.type(screen.getByLabelText("Shop"), "Netto");
    await user.click(screen.getByRole("button", { name: "Add price" }));

    await waitFor(() =>
      expect(mock.callsTo("POST", "/api/items/i1/prices")[0]?.body).toEqual({
        price: 2.5,
        shop: "Netto",
      }),
    );
    // The refetched history flows into the chart: two points, oldest → newest.
    await waitFor(() => expect(uPlotCtor).toHaveBeenCalledTimes(2));
    expect(chartData()[1]).toEqual([1.99, 2.5]);
    await waitFor(() => expect(pricePoints()).toHaveLength(2));
    const points = pricePoints();
    expect(points[0]).toHaveTextContent("1.99");
    expect(points[0]).toHaveTextContent("Lidl");
    expect(points[1]).toHaveTextContent("2.50");
    expect(points[1]).toHaveTextContent("Netto");
  });

  it("blocks an empty price submission client-side", async () => {
    const mock = createApiFetchMock();
    mock.on("GET", "/api/items/i1", () => json(200, detail));
    mock.on("GET", "/api/lists/l1/categories", () => json(200, CATEGORIES));
    mock.stub();
    const user = userEvent.setup();
    renderPage();

    await screen.findByDisplayValue("Milk");
    await user.type(screen.getByLabelText("Shop"), "Netto");
    await user.click(screen.getByRole("button", { name: "Add price" }));

    expect(await screen.findByText("Enter a price greater than 0.")).toBeInTheDocument();
    expect(mock.callsTo("POST", "/api/items/i1/prices")).toHaveLength(0);
  });

  it("round-trips an image (DoD): pick → client downscale → multipart POST → stored /static URL", async () => {
    const imageStub = stubImagePipeline({ width: 2400, height: 1800 });
    const objectUrls = stubObjectUrls();
    const mock = createApiFetchMock();
    mock.on("GET", "/api/items/i1", () => json(200, detail));
    mock.on("GET", "/api/lists/l1/categories", () => json(200, CATEGORIES));
    mock.on("POST", "/api/items/i1/image", () => {
      detail = { ...detail, imageFilename: "i1-newhash.webp" };
      return json(200, { imageFilename: "i1-newhash.webp" });
    });
    mock.stub();
    const user = userEvent.setup();
    renderPage();

    await screen.findByDisplayValue("Milk");
    expect(screen.queryByTestId("item-image")).not.toBeInTheDocument();

    const file = new File(["jpeg-bytes"], "photo.jpg", { type: "image/jpeg" });
    await user.upload(screen.getByLabelText("Choose photo"), file);
    await user.click(screen.getByRole("button", { name: "Upload photo" }));

    await waitFor(() => expect(mock.callsTo("POST", "/api/items/i1/image")).toHaveLength(1));
    const call = mock.callsTo("POST", "/api/items/i1/image")[0];
    expect(call?.body).toBeInstanceOf(FormData);
    const sent = call?.body as FormData;
    expect(sent.get("image")).toBeInstanceOf(Blob);
    // The client downscale ran before the POST (1200 px long edge, webp).
    expect(imageStub.drawImageCalls[0]).toMatchObject({ dx: 0, dy: 0, width: 1200, height: 900 });
    expect(imageStub.toBlobCalls[0]?.type).toBe("image/webp");

    // The server's content-addressed filename lands back in the UI.
    expect(await screen.findByTestId("item-image")).toHaveAttribute(
      "src",
      "/static/i1-newhash.webp",
    );
    expect(screen.queryByRole("button", { name: "Upload photo" })).toBeDisabled();
    objectUrls.restore();
  });

  it("shows the category read-only when the list context is missing (deep link)", async () => {
    const mock = createApiFetchMock();
    mock.on("GET", "/api/items/i1", () => json(200, detail));
    mock.stub();
    renderPage(null);

    expect(await screen.findByText("Other")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Category" })).not.toBeInTheDocument();
    expect(mock.calls.length).toBe(1);
  });

  it("shows an alert when the item cannot be loaded", async () => {
    const mock = createApiFetchMock();
    mock.on("GET", "/api/items/unknown", () =>
      json(404, { error: { code: "NOT_FOUND", message: "Item not found" } }),
    );
    mock.stub();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/items/unknown"]}>
          <Routes>
            <Route path="/items/:itemId" element={<ItemDetailsPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText(/Could not load this item/)).toBeInTheDocument();
  });
});
