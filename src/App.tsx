import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import SplashScreen from './components/SplashScreen'
import OfflineBanner from './components/OfflineBanner'
import OnboardingScreen from './screens/OnboardingScreen'
import LoginScreen from './screens/LoginScreen'
import SignupScreen from './screens/SignupScreen'
import ClassSelectionScreen from './screens/ClassSelectionScreen'
import HomeScreen from './screens/HomeScreen'
import SubjectsScreen from './screens/SubjectsScreen'
import ChaptersScreen from './screens/ChaptersScreen'
import ChapterDetailScreen from './screens/ChapterDetailScreen'
import QuizScreen from './screens/QuizScreen'
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
        <Route path="/signup" element={<PublicRoute><SignupScreen /></PublicRoute>} />
        <Route path="/onboarding-class" element={<ProtectedRoute><ClassSelectionScreen /></ProtectedRoute>} />
        <Route path="/home" element={<ProtectedRoute><HomeScreen /></ProtectedRoute>} />
        <Route path="/subjects" element={<ProtectedRoute><SubjectsScreen /></ProtectedRoute>} />
        <Route path="/chapters/:subjectId" element={<ProtectedRoute><ChaptersScreen /></ProtectedRoute>} />
        <Route path="/chapter/:chapterId" element={<ProtectedRoute><ChapterDetailScreen /></ProtectedRoute>} />
        <Route path="/quiz" element={<ProtectedRoute><QuizScreen /></ProtectedRoute>} />
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
