import type { ReactNode } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./stores/auth";
import { ThemeProvider } from "./stores/theme";
import { RouteGuard } from "./components/RouteGuard";
import { AppShell } from "./components/AppShell";
import { DesktopSidebar } from "./components/DesktopSidebar";
import { DocumentTitle } from "./components/DocumentTitle";

import { FeedPage } from "./app/feed/FeedPage";
import { LivePage } from "./app/live/LivePage";
import { EvPage } from "./app/ev/EvPage";
import { RankingPage } from "./app/ranking/RankingPage";
import { GamesPage } from "./app/games/GamesPage";
import { SearchPage } from "./app/search/SearchPage";
import { TipPage } from "./app/tip/TipPage";
import { AiAnalysisPage } from "./app/ai-analysis/AiAnalysisPage";
import { VipGroupPage } from "./app/vip-group/VipGroupPage";
import { CheckoutPage } from "./app/checkout/CheckoutPage";
import { MyProfilePage } from "./app/profile-me/MyProfilePage";
import { EditProfilePage } from "./app/edit-profile/EditProfilePage";
import { ProfilePage } from "./app/profile/ProfilePage";
import { NewTipPage } from "./app/new-tip/NewTipPage";
import { RobotPage } from "./app/robot/RobotPage";
import { MarketChartPage } from "./app/robot/MarketChartPage";
import { MarketsPage } from "./app/robot/MarketsPage";
import { AdminPage } from "./app/admin/AdminPage";
import { AdminRolesPage } from "./app/admin/roles/AdminRolesPage";
import { AdminPaymentsPage } from "./app/admin/payments/AdminPaymentsPage";
import { AdminScreensPage } from "./app/admin/screens/AdminScreensPage";
import { LoginPage } from "./app/login/LoginPage";
import { RegisterPage } from "./app/register/RegisterPage";
import { ForgotPasswordPage } from "./app/forgot-password/ForgotPasswordPage";
import { ResetPasswordPage } from "./app/reset-password/ResetPasswordPage";

/**
 * The handoff design is a 390x844 phone frame for almost every screen — this
 * keeps those screens phone-width even on a desktop browser window instead
 * of stretching edge-to-edge. Only screens without a real desktop layout
 * built into their own component yet (Login/Register/Tip/Checkout/Editar
 * Perfil/Admin*) still use this. AppShell-wrapped screens (Feed, Ao Vivo,
 * Ranking, Meu Perfil, Jogos, Robô) and SidebarFrame-wrapped screens (Busca,
 * Nova Tip, Grupo VIP, Análise IA, EV+, Gráfico Robô) opt out: they keep the
 * desktop nav rail visible instead of floating a phone-width box in the
 * middle of a wide viewport.
 */
function MobileFrame({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto min-h-dvh w-full max-w-[430px] bg-bg sm:border-x sm:border-border">
      {children}
    </div>
  );
}

/**
 * Routes that manage their own mobile chrome (a pushed full-screen flow —
 * back button or "X to cancel", no tab bar) but still belong under the
 * desktop nav rail once you're at a wide viewport, instead of being boxed
 * into a phone-width column floating in the middle of the screen. Unlike
 * AppShell, this doesn't add a mobile header/tab bar — the wrapped page
 * still owns 100% of the mobile screen, exactly as before.
 */
function SidebarFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-dvh overflow-hidden bg-bg text-text">
      <DesktopSidebar />
      <div className="min-w-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
      <AuthProvider>
        <DocumentTitle />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />

          {/* Tab-bar screens share the AppShell chrome (header + bottom nav
              on mobile, sidebar rail on desktop) */}
          <Route
            path="/"
            element={
              <RouteGuard screen="feed">
                <AppShell>
                  <FeedPage />
                </AppShell>
              </RouteGuard>
            }
          />
          <Route
            path="/live"
            element={
              <RouteGuard screen="ao_vivo">
                <AppShell>
                  <LivePage />
                </AppShell>
              </RouteGuard>
            }
          />
          <Route
            path="/ranking"
            element={
              <RouteGuard screen="ranking">
                <AppShell>
                  <RankingPage />
                </AppShell>
              </RouteGuard>
            }
          />
          <Route
            path="/profile"
            element={
              <RouteGuard screen="meu_perfil">
                <AppShell>
                  <MyProfilePage />
                </AppShell>
              </RouteGuard>
            }
          />

          <Route
            path="/profile/edit"
            element={
              <RouteGuard screen="meu_perfil">
                <SidebarFrame>
                  <EditProfilePage />
                </SidebarFrame>
              </RouteGuard>
            }
          />

          <Route
            path="/games"
            element={
              <RouteGuard screen="jogos">
                <AppShell>
                  <GamesPage />
                </AppShell>
              </RouteGuard>
            }
          />

          {/* Full-screen (pushed) routes — no desktop design yet, so these
              stay phone-width even on wide viewports */}
          <Route
            path="/ev"
            element={
              <RouteGuard screen="ev_plus">
                <SidebarFrame>
                  <EvPage />
                </SidebarFrame>
              </RouteGuard>
            }
          />
          <Route
            path="/search"
            element={
              <RouteGuard screen="busca">
                <SidebarFrame>
                  <SearchPage />
                </SidebarFrame>
              </RouteGuard>
            }
          />
          <Route
            path="/tip/:tipId"
            element={
              <RouteGuard screen="tip_aberta">
                <SidebarFrame>
                  <TipPage />
                </SidebarFrame>
              </RouteGuard>
            }
          />
          <Route
            path="/tip/:tipId/ai-analysis"
            element={
              <RouteGuard screen="analise_ia">
                <SidebarFrame>
                  <AiAnalysisPage />
                </SidebarFrame>
              </RouteGuard>
            }
          />
          <Route
            path="/vip/:groupId"
            element={
              <RouteGuard screen="grupo_vip">
                <SidebarFrame>
                  <VipGroupPage />
                </SidebarFrame>
              </RouteGuard>
            }
          />
          <Route
            path="/vip/:groupId/checkout"
            element={
              <RouteGuard screen="checkout">
                <MobileFrame>
                  <CheckoutPage />
                </MobileFrame>
              </RouteGuard>
            }
          />
          <Route
            path="/u/:username"
            element={
              <RouteGuard screen="perfil">
                <SidebarFrame>
                  <ProfilePage />
                </SidebarFrame>
              </RouteGuard>
            }
          />
          <Route
            path="/new-tip"
            element={
              <RouteGuard screen="nova_tip">
                <SidebarFrame>
                  <NewTipPage />
                </SidebarFrame>
              </RouteGuard>
            }
          />
          <Route
            path="/robot"
            element={
              <RouteGuard screen="robo_apostas">
                <AppShell>
                  <RobotPage />
                </AppShell>
              </RouteGuard>
            }
          />
          <Route
            path="/robot/history"
            element={
              <RouteGuard screen="robo_apostas">
                <AppShell>
                  <MarketsPage />
                </AppShell>
              </RouteGuard>
            }
          />
          <Route
            path="/robot/market/:groupKey"
            element={
              <RouteGuard screen="robo_apostas">
                <SidebarFrame>
                  <MarketChartPage />
                </SidebarFrame>
              </RouteGuard>
            }
          />
          <Route
            path="/admin"
            element={
              <RouteGuard screen="admin">
                <SidebarFrame>
                  <AdminPage />
                </SidebarFrame>
              </RouteGuard>
            }
          />
          <Route
            path="/admin/roles"
            element={
              <RouteGuard screen="admin_roles">
                <SidebarFrame>
                  <AdminRolesPage />
                </SidebarFrame>
              </RouteGuard>
            }
          />
          <Route
            path="/admin/payments"
            element={
              <RouteGuard screen="admin_payments">
                <SidebarFrame>
                  <AdminPaymentsPage />
                </SidebarFrame>
              </RouteGuard>
            }
          />
          <Route
            path="/admin/screens"
            element={
              <RouteGuard screen="admin_screens">
                <SidebarFrame>
                  <AdminScreensPage />
                </SidebarFrame>
              </RouteGuard>
            }
          />
        </Routes>
      </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}

export default App;
