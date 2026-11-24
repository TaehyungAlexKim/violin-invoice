import { useEffect } from 'react'
import { HashRouter } from 'react-router-dom'
import { RecoveryRouter } from './auth/ProtectedRouter'
import './App.css'

export {
  buildPasswordResetRedirectUrl,
  hasImplicitRecoveryCallback,
  isOperatorUser,
  passwordResetRedirectUrl,
  signOutLocalSession,
  studentDeleteError,
  validatePassword,
} from './auth/ProtectedRouter'

export default function App() {
  useEffect(() => { document.documentElement.lang = 'en-CA' }, [])
  return <HashRouter><RecoveryRouter /></HashRouter>
}
