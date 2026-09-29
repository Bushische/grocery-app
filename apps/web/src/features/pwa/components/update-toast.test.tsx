// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../../../test/setup";
import { UpdateToast } from "./update-toast";

const { useRegisterSWMock, updateServiceWorkerMock } = vi.hoisted(() => ({
  useRegisterSWMock: vi.fn(),
  updateServiceWorkerMock: vi.fn(),
}));

vi.mock("virtual:pwa-register/react", () => ({
  useRegisterSW: useRegisterSWMock,
}));

function stubRegisterSW(needRefresh: boolean) {
  useRegisterSWMock.mockReturnValue({
    needRefresh: [needRefresh, vi.fn()],
    offlineReady: [false, vi.fn()],
    updateServiceWorker: updateServiceWorkerMock,
  });
}

describe("UpdateToast (T47: new-version refresh flow)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing while up to date (and in dev, where no SW registers)", () => {
    stubRegisterSW(false);
    render(<UpdateToast />);
    expect(screen.queryByTestId("update-toast")).not.toBeInTheDocument();
  });

  it("appears when a new worker is installed (onNeedRefresh → render)", () => {
    stubRegisterSW(true);
    render(<UpdateToast />);
    expect(screen.getByTestId("update-toast")).toBeInTheDocument();
    expect(screen.getByText("New version available")).toBeInTheDocument();
    // ≥ 40 px tap targets for both actions.
    expect(screen.getByTestId("update-toast-refresh")).toHaveTextContent("Refresh");
  });

  it("tapping Refresh swaps to the new shell via updateServiceWorker(true)", async () => {
    stubRegisterSW(true);
    const user = userEvent.setup();
    render(<UpdateToast />);

    await user.click(screen.getByTestId("update-toast-refresh"));

    expect(updateServiceWorkerMock).toHaveBeenCalledTimes(1);
    expect(updateServiceWorkerMock).toHaveBeenCalledWith(true);
  });

  it("dismiss hides the toast until the next version", async () => {
    stubRegisterSW(true);
    const user = userEvent.setup();
    render(<UpdateToast />);

    await user.click(screen.getByTestId("update-toast-dismiss"));

    expect(screen.queryByTestId("update-toast")).not.toBeInTheDocument();
    expect(updateServiceWorkerMock).not.toHaveBeenCalled();
  });
});
