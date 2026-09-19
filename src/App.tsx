import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import SplashScreen from './components/SplashScreen'
import OfflineBanner from './components/OfflineBanner'
import OnboardingScreen from './screens/OnboardingScreen'
import LoginScreen from './screens/LoginScreen'
import SignupScreen from './screens/SignupScreen'
import ClassSelectionScreen from './screens/ClassSelectionScreen'
import AuthCallbackScreen from './screens/AuthCallbackScreen'
import WelcomeMomentScreen from './screens/WelcomeMomentScreen'
import WhatsAppPromptScreen from './screens/WhatsAppPromptScreen'
import CompleteProfileScreen from './screens/CompleteProfileScreen'
import HomeScreen from './screens/HomeScreen'
import SubjectsScreen from './screens/SubjectsScreen'
import ChaptersScreen from './screens/ChaptersScreen'
import ChapterDetailScreen from './screens/ChapterDetailScreen'
import QuizScreen from './screens/QuizScreen'
import QuizSubjectsScreen from './screens/QuizSubjectsScreen'
import QuizResultsScreen from './screens/QuizResultsScreen'
import MockTestScreen from './screens/MockTestScreen'
import ChapterMockTestScreen from './screens/ChapterMockTestScreen'
import MockTestPrintView from './screens/MockTestPrintView'
import ChapterExerciseTestScreen from './screens/ChapterExerciseTestScreen'
import ExerciseTestPrintView from './screens/ExerciseTestPrintView'
import AiTutorScreen from './screens/AiTutorScreen'
import ProgressScreen from './screens/ProgressScreen'
import StudyPlanScreen from './screens/StudyPlanScreen'
import PastPapersScreen from './screens/PastPapersScreen'
import LeaderboardScreen from './screens/LeaderboardScreen'
import ProfileScreen from './screens/ProfileScreen'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <SplashScreen />
  if (!user) return <Navigate to="/" replace />
  return <>{children}</>
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
  return (
    <div className="min-h-screen max-w-sm mx-auto bg-white dark:bg-slate-900 shadow-2xl">
      <OfflineBanner />
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
        <Route path="/progress" element={<ProtectedRoute><ProgressScreen /></ProtectedRoute>} />
        <Route path="/study-plan" element={<ProtectedRoute><StudyPlanScreen /></ProtectedRoute>} />
        <Route path="/past-papers" element={<ProtectedRoute><PastPapersScreen /></ProtectedRoute>} />
        <Route path="/leaderboard" element={<ProtectedRoute><LeaderboardScreen /></ProtectedRoute>} />
        <Route path="/profile" element={<ProtectedRoute><ProfileScreen /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
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
