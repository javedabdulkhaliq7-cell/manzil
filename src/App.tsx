import { Suspense, lazy, useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import SplashScreen from './components/SplashScreen'
import OfflineBanner from './components/OfflineBanner'
import SyncStatusBanner from './components/SyncStatusBanner'
import { registerBackgroundSync } from './lib/backgroundSync'
import { startOfflineSync, installAccountGuard } from './lib/offlineSync'
import { getCachedProfileObject } from './lib/localProfileCache'
import { Capacitor } from '@capacitor/core'

// Every screen below is now lazy-loaded — each becomes its own small JS
// file that's only downloaded when the user actually navigates there,
// instead of all ~26 screens being bundled into one giant file upfront.
const OnboardingScreen = lazy(() => import('./screens/OnboardingScreen'))
const LoginScreen = lazy(() => import('./screens/LoginScreen'))
const SignupScreen = lazy(() => import('./screens/SignupScreen'))
const ClassSelectionScreen = lazy(() => import('./screens/ClassSelectionScreen'))
const AuthCallbackScreen = lazy(() => import('./screens/AuthCallbackScreen'))
const WelcomeMomentScreen = lazy(() => import('./screens/WelcomeMomentScreen'))
const WelcomeBackScreen = lazy(() => import('./screens/WelcomeBackScreen'))
const WhatsAppPromptScreen = lazy(() => import('./screens/WhatsAppPromptScreen'))
const CompleteProfileScreen = lazy(() => import('./screens/CompleteProfileScreen'))
const HomeScreen = lazy(() => import('./screens/HomeScreen'))
const SubjectsScreen = lazy(() => import('./screens/SubjectsScreen'))
const ChaptersScreen = lazy(() => import('./screens/ChaptersScreen'))
const ChapterDetailScreen = lazy(() => import('./screens/ChapterDetailScreen'))
const QuizScreen = lazy(() => import('./screens/QuizScreen'))
const QuizSubjectsScreen = lazy(() => import('./screens/QuizSubjectsScreen'))
const QuizResultsScreen = lazy(() => import('./screens/QuizResultsScreen'))
const MockTestScreen = lazy(() => import('./screens/MockTestScreen'))
const ChapterMockTestScreen = lazy(() => import('./screens/ChapterMockTestScreen'))
const MockTestPrintView = lazy(() => import('./screens/MockTestPrintView'))
const ChapterExerciseTestScreen = lazy(() => import('./screens/ChapterExerciseTestScreen'))
const ExerciseTestPrintView = lazy(() => import('./screens/ExerciseTestPrintView'))
const AiTutorScreen = lazy(() => import('./screens/AiTutorScreen'))
const StudyPlanScreen = lazy(() => import('./screens/StudyPlanScreen'))
const ScanScreen = lazy(() => import('./screens/ScanScreen'))
const ScanCaptureScreen = lazy(() => import('./screens/ScanCaptureScreen'))
const ScanViewerScreen = lazy(() => import('./screens/ScanViewerScreen'))
const ScanPagesScreen = lazy(() => import('./screens/ScanPagesScreen'))
const ScanStorageScreen = lazy(() => import('./screens/ScanStorageScreen'))
const PastPapersScreen = lazy(() => import('./screens/PastPapersScreen'))
const PaperViewerScreen = lazy(() => import('./screens/PaperViewerScreen'))
const PaperExamScreen = lazy(() => import('./screens/PaperExamScreen'))
const DownloadedPapersScreen = lazy(() => import('./screens/DownloadedPapersScreen'))
const LeaderboardScreen = lazy(() => import('./screens/LeaderboardScreen'))
const ProfileScreen = lazy(() => import('./screens/ProfileScreen'))

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <SplashScreen />
  if (!user) return <Navigate to="/" replace />
  return <>{children}</>
}

// IQRA Scanner routes: like ProtectedRoute, but in the Android app a student
// whose login session expired while offline can still open their own scans
// (the last-known profile cached on the phone stands in for the session).
function ScanRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  const [offlineOk, setOfflineOk] = useState<boolean | null>(null)
  useEffect(() => {
    if (loading || user) return
    if (!Capacitor.isNativePlatform()) { setOfflineOk(false); return }
    getCachedProfileObject().then((p) => setOfflineOk(!!p)).catch(() => setOfflineOk(false))
  }, [user, loading])
  if (loading) return <SplashScreen />
  if (user) return <>{children}</>
  if (offlineOk === null) return <SplashScreen />
  return offlineOk ? <>{children}</> : <Navigate to="/" replace />
}

// Onboarding/Login/Signup are for logged-out visitors only — if a session
// already exists, skip straight to Home instead of showing the marketing/
// login screens again on every app open.
function PublicRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <SplashScreen />
  if (user) return <Navigate to="/home" replace />
  return <>{children}</>
}

function AppRoutes() {
  // Phase 8 — best-effort background sync; harmless no-op on web.
  useEffect(() => { registerBackgroundSync() }, [])

  // Downloaded papers (Phase 11): saved copies belong to one account and are removed when it leaves
  // this phone; anything made offline is uploaded when the connection returns.
  const { user } = useAuth()
  useEffect(() => installAccountGuard(), [])
  useEffect(() => {
    if (!user?.id) return
    return startOfflineSync(user.id)
  }, [user?.id])

  // IQRA Scanner: while online after login, quietly download Google's scanner module so it
  // is ready offline later. Harmless if already installed; skipped on the website.
  useEffect(() => {
    if (!user?.id || !Capacitor.isNativePlatform()) return
    import('./lib/scanner/scannerService').then((m) => m.ensureScannerModule()).catch(() => {})
  }, [user?.id])

  return (
    <div className="min-h-screen max-w-sm mx-auto bg-white dark:bg-slate-900 shadow-2xl">
      <OfflineBanner />
      <SyncStatusBanner />
      {/* Suspense fallback shows while a lazy screen's chunk is downloading
          — reuses SplashScreen so it looks identical to the existing
          auth-loading state, not a new/different loading UI. */}
      <Suspense fallback={<SplashScreen />}>
        <Routes>
          <Route path="/" element={<PublicRoute><OnboardingScreen /></PublicRoute>} />
          <Route path="/login" element={<PublicRoute><LoginScreen /></PublicRoute>} />
          {/* Pre-auth class pick — Welcome -> here -> Signup, per the foot-in-
              the-door ordering (easy choice before account creation). Reuses
              ClassSelectionScreen, which detects the logged-out case itself
              and stores the pick in localStorage instead of writing to
              profiles (no user id exists yet). */}
          <Route path="/select-class" element={<PublicRoute><ClassSelectionScreen /></PublicRoute>} />
          <Route path="/signup" element={<PublicRoute><SignupScreen /></PublicRoute>} />
          {/* Deliberately outside PublicRoute/ProtectedRoute — see
              AuthCallbackScreen.tsx for why it needs to manage its own
              loading/redirect instead of using those wrappers. */}
          <Route path="/auth/callback" element={<AuthCallbackScreen />} />
          {/* Screens 4-5 — shown once, right after a brand-new account is
              created (either signup path), before landing on /home. */}
          <Route path="/welcome-moment" element={<ProtectedRoute><WelcomeMomentScreen /></ProtectedRoute>} />
          {/* Returning-login counterpart to /welcome-moment — see
              AuthCallbackScreen for the new-vs-returning branch that picks
              between the two. */}
          <Route path="/welcome-back" element={<ProtectedRoute><WelcomeBackScreen /></ProtectedRoute>} />
          <Route path="/whatsapp-invite" element={<ProtectedRoute><WhatsAppPromptScreen /></ProtectedRoute>} />
          <Route path="/complete-profile" element={<ProtectedRoute><CompleteProfileScreen /></ProtectedRoute>} />
          {/* Post-auth class pick/switch — reached from Profile -> "My Board
              & Class". Same component, but a user session exists here, so it
              writes straight to profiles as before. */}
          <Route path="/onboarding-class" element={<ProtectedRoute><ClassSelectionScreen /></ProtectedRoute>} />
          <Route path="/home" element={<ProtectedRoute><HomeScreen /></ProtectedRoute>} />
          <Route path="/subjects" element={<ProtectedRoute><SubjectsScreen /></ProtectedRoute>} />
          <Route path="/chapters/:subjectId" element={<ProtectedRoute><ChaptersScreen /></ProtectedRoute>} />
          <Route path="/chapter/:chapterId" element={<ProtectedRoute><ChapterDetailScreen /></ProtectedRoute>} />
          {/* Bare /quiz — previously rendered QuizScreen directly with no
              chapterId, which dead-ended on "No MCQs Available" every time
              (QuizScreen has always required a chapter to draw from). Now
              it's a subject list; tapping a subject jumps straight into a
              random quiz across every chapter in it — no chapter-picker
              step, since chapter-specific quizzing already exists via
              Subjects → Chapters → Chapter Detail. /quiz/:chapterId (single-
              chapter quiz) is unchanged — ChapterDetailScreen still links
              straight to it. */}
          <Route path="/quiz" element={<ProtectedRoute><QuizSubjectsScreen /></ProtectedRoute>} />
          <Route path="/quiz/random/:subjectId" element={<ProtectedRoute><QuizScreen /></ProtectedRoute>} />
          <Route path="/quiz/:chapterId" element={<ProtectedRoute><QuizScreen /></ProtectedRoute>} />
          <Route path="/quiz-results" element={<ProtectedRoute><QuizResultsScreen /></ProtectedRoute>} />
          <Route path="/mock-test" element={<ProtectedRoute><MockTestScreen /></ProtectedRoute>} />
          <Route path="/mock-test/:subjectId" element={<ProtectedRoute><MockTestScreen /></ProtectedRoute>} />
          <Route path="/mock-test/chapter/:chapterId" element={<ProtectedRoute><ChapterMockTestScreen /></ProtectedRoute>} />
          <Route path="/mock-test/chapter/:chapterId/print" element={<ProtectedRoute><MockTestPrintView /></ProtectedRoute>} />
          <Route path="/exercise-test/:chapterId" element={<ProtectedRoute><ChapterExerciseTestScreen /></ProtectedRoute>} />
          <Route path="/exercise-test/:chapterId/print" element={<ProtectedRoute><ExerciseTestPrintView /></ProtectedRoute>} />
          <Route path="/ai-tutor" element={<ProtectedRoute><AiTutorScreen /></ProtectedRoute>} />
          <Route path="/ai-tutor/:chapterId" element={<ProtectedRoute><AiTutorScreen /></ProtectedRoute>} />
          <Route path="/study-plan" element={<ProtectedRoute><StudyPlanScreen /></ProtectedRoute>} />
          {/* IQRA Scanner — full-screen section, no BottomNav (see ScanScreen). */}
          <Route path="/scan" element={<ScanRoute><ScanScreen /></ScanRoute>} />
          <Route path="/scan/new" element={<ScanRoute><ScanCaptureScreen /></ScanRoute>} />
          <Route path="/scan/view/:scanId" element={<ScanRoute><ScanViewerScreen /></ScanRoute>} />
          <Route path="/scan/pages/:scanId" element={<ScanRoute><ScanPagesScreen /></ScanRoute>} />
          <Route path="/scan/storage" element={<ScanRoute><ScanStorageScreen /></ScanRoute>} />
          <Route path="/past-papers" element={<ProtectedRoute><PastPapersScreen /></ProtectedRoute>} />
          <Route path="/downloads" element={<ProtectedRoute><DownloadedPapersScreen /></ProtectedRoute>} />
          <Route path="/past-papers/:paperId" element={<ProtectedRoute><PaperViewerScreen /></ProtectedRoute>} />
          <Route path="/past-papers/:paperId/exam" element={<ProtectedRoute><PaperExamScreen /></ProtectedRoute>} />
          <Route path="/generated-papers/:paperId" element={<ProtectedRoute><PaperViewerScreen /></ProtectedRoute>} />
          <Route path="/generated-papers/:paperId/exam" element={<ProtectedRoute><PaperExamScreen /></ProtectedRoute>} />
          <Route path="/leaderboard" element={<ProtectedRoute><LeaderboardScreen /></ProtectedRoute>} />
          <Route path="/profile" element={<ProtectedRoute><ProfileScreen /></ProtectedRoute>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}
