import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Avatar, AvatarStack } from "./Avatar.tsx";
import { colourIndex, initials } from "./avatar-utils.ts";
import { Button } from "./Button.tsx";
import { Checkbox } from "./Checkbox.tsx";
import { Dialog, DialogContent, DialogTrigger } from "./Dialog.tsx";
import { EmptyState } from "./EmptyState.tsx";
import { IconButton } from "./IconButton.tsx";
import { KbdHint } from "./KbdHint.tsx";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "./Menu.tsx";
import { Pill } from "./Pill.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "./Popover.tsx";
import { SegmentedTabs } from "./SegmentedTabs.tsx";
import { TextField } from "./TextField.tsx";
import { SkeletonSquiggle } from "./SkeletonSquiggle.tsx";
import { Toggle } from "./Toggle.tsx";
import { clearToasts, toast } from "./toast-store.ts";
import { UiProvider } from "./UiProvider.tsx";

function renderUi(ui: React.ReactNode) {
  return render(<UiProvider>{ui}</UiProvider>);
}

afterEach(() => {
  act(() => {
    clearToasts();
  });
});

describe("Pill and IconButton", () => {
  it("renders a pill button that is pressable", async () => {
    const onClick = vi.fn();
    renderUi(<Pill onClick={onClick}>Share</Pill>);
    await userEvent.click(screen.getByRole("button", { name: "Share" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("gives an icon button an accessible name", () => {
    renderUi(<IconButton label="Search" icon={<svg />} shortcut="Mod+F" />);
    expect(screen.getByRole("button", { name: "Search" })).toBeInTheDocument();
  });
});

describe("KbdHint", () => {
  it("renders the shortcut keys", () => {
    render(<KbdHint shortcut="Ctrl+N" />);
    expect(screen.getByText("N")).toBeInTheDocument();
  });
});

describe("SegmentedTabs", () => {
  function Harness() {
    const [value, setValue] = useState<"open" | "done">("open");
    return (
      <SegmentedTabs
        label="Filter"
        value={value}
        onValueChange={setValue}
        tabs={[
          { value: "open", label: "Open" },
          { value: "done", label: "Completed" },
        ]}
      />
    );
  }

  it("switches the active tab and never deselects", async () => {
    render(<Harness />);
    const open = screen.getByRole("radio", { name: "Open" });
    const done = screen.getByRole("radio", { name: "Completed" });
    expect(open).toHaveAttribute("data-state", "on");
    await userEvent.click(done);
    expect(done).toHaveAttribute("data-state", "on");
    await userEvent.click(done);
    expect(done).toHaveAttribute("data-state", "on");
  });
});

describe("Popover, Menu, Dialog", () => {
  it("opens a popover", async () => {
    renderUi(
      <Popover>
        <PopoverTrigger>Due date</PopoverTrigger>
        <PopoverContent>Calendar here</PopoverContent>
      </Popover>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Due date" }));
    expect(await screen.findByText("Calendar here")).toBeInTheDocument();
  });

  it("opens a menu and selects an item", async () => {
    const onSelect = vi.fn();
    renderUi(
      <Menu>
        <MenuTrigger>More</MenuTrigger>
        <MenuContent>
          <MenuItem onSelect={onSelect}>Duplicate</MenuItem>
          <MenuItem destructive>Delete list</MenuItem>
        </MenuContent>
      </Menu>,
    );
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    expect(await screen.findByRole("menuitem", { name: "Delete list" })).toHaveAttribute(
      "data-destructive",
    );
    await userEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("opens a dialog with an accessible title and closes on Escape", async () => {
    renderUi(
      <Dialog>
        <DialogTrigger>Open</DialogTrigger>
        <DialogContent title="Keyboard shortcuts">Body</DialogContent>
      </Dialog>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(await screen.findByRole("dialog", { name: "Keyboard shortcuts" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("Toast", () => {
  it("shows a toast with a working action", async () => {
    const undo = vi.fn();
    renderUi(<div />);
    act(() => {
      toast("Task moved to 1 Dec", { action: { label: "Undo", onAction: undo } });
    });
    expect(await screen.findByText("Task moved to 1 Dec")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(undo).toHaveBeenCalledOnce();
  });
});

describe("Toggle and Checkbox", () => {
  it("toggles a switch", async () => {
    const onChange = vi.fn();
    render(<Toggle label="Sounds" onCheckedChange={onChange} />);
    const sw = screen.getByRole("switch", { name: "Sounds" });
    await userEvent.click(sw);
    expect(sw).toHaveAttribute("aria-checked", "true");
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("checks a task checkbox (uncontrolled and controlled)", async () => {
    const onChange = vi.fn();
    const { rerender } = render(<Checkbox label="Buy milk" onCheckedChange={onChange} />);
    const box = screen.getByRole("checkbox", { name: "Buy milk" });
    await userEvent.click(box);
    expect(box).toHaveAttribute("aria-checked", "true");
    rerender(<Checkbox label="Buy milk" checked={false} onCheckedChange={onChange} />);
    expect(box).toHaveAttribute("aria-checked", "false");
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe("Avatar", () => {
  it("derives initials and a stable colour", () => {
    expect(initials("Karan Mehta")).toBe("KM");
    expect(initials("alex")).toBe("A");
    expect(initials("  ")).toBe("?");
    expect(colourIndex("abc")).toBe(colourIndex("abc"));
    expect(colourIndex("abc")).toBeLessThan(6);
  });

  it("renders a fallback and a +N stack", () => {
    render(
      <>
        <Avatar name="Sam Lee" />
        <AvatarStack
          people={[{ name: "A B" }, { name: "C D" }, { name: "E F" }, { name: "G H" }]}
          max={2}
        />
      </>,
    );
    expect(screen.getByRole("img", { name: "Sam Lee" })).toHaveTextContent("SL");
    expect(screen.getByText("+2")).toBeInTheDocument();
  });
});

describe("EmptyState and SkeletonSquiggle", () => {
  it("renders a sentence and skeleton rows", () => {
    render(
      <>
        <EmptyState>Nothing here yet.</EmptyState>
        <SkeletonSquiggle rows={3} />
      </>,
    );
    expect(screen.getByText("Nothing here yet.")).toBeInTheDocument();
    expect(screen.getByTestId("skeleton-squiggle").children).toHaveLength(3);
  });
});

describe("Button and TextField", () => {
  it("blocks clicks while loading", async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Log in
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Log in" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("labels the input and describes it with the error", () => {
    render(<TextField label="Email" hint="We'll send a link" error="Enter a valid email" />);
    const input = screen.getByLabelText("Email");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Enter a valid email");
    expect(screen.queryByText("We'll send a link")).not.toBeInTheDocument();
  });
});
