import { useState } from "react";
import { Outlet } from "react-router-dom";
import { CommandPalette } from "@/components/CommandPalette";
import { FeedbackButton } from "@/components/FeedbackButton";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useMediaQuery } from "@/hooks/use-media-query";
import { usePersistentState } from "@/hooks/use-persistent-state";
import { useTranslation } from "@/i18n";
import { Header } from "./Header";
import { Sidebar } from "./Sidebar";
import { Slot } from "./slot-registry";

export function MainLayout() {
  const { t } = useTranslation();
  const [sidebarCollapsed, setSidebarCollapsed] = usePersistentState(
    "inkvoice-sidebar-collapsed",
    false,
  );
  const [mobileOpen, setMobileOpen] = useState(false);
  const isMobile = useMediaQuery("(max-width: 768px)");

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:p-4 focus:bg-background focus:text-foreground"
      >
        {t("a11y.skip_to_content")}
      </a>
      {/* Desktop sidebar */}
      {!isMobile && <Sidebar collapsed={sidebarCollapsed} />}

      {/* Mobile sidebar */}
      {isMobile && (
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" className="p-0 w-[216px]">
            <Sidebar />
          </SheetContent>
        </Sheet>
      )}

      <div className="flex-1 flex flex-col overflow-hidden">
        <Slot name="top-banners" />
        <Header
          onToggleSidebar={() => {
            if (isMobile) {
              setMobileOpen(!mobileOpen);
            } else {
              setSidebarCollapsed(!sidebarCollapsed);
            }
          }}
        />
        <main
          id="main-content"
          className="flex-1 overflow-auto px-4 pt-4 pb-6 md:px-6 md:pt-5 md:pb-7"
        >
          <Outlet />
        </main>
      </div>
      <FeedbackButton />
      <CommandPalette />
    </div>
  );
}
