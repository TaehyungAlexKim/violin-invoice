import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { supabase } from '../data/supabase'
import { signOutLocalSession } from '../auth/AuthPages'
import { finishRecovery } from '../auth/recovery'

export function Shell({children}: {children: ReactNode}) {
  const [email,setEmail]=useState('')
  const [logoutError,setLogoutError]=useState('')
  const navigate=useNavigate()
  useEffect(()=>{void supabase?.auth.getUser().then(({data})=>setEmail(data.user?.email ?? ''))},[])
  async function logout(){
    if(!supabase)return
    setLogoutError('')
    const signOutError=await signOutLocalSession(supabase)
    if(signOutError){setLogoutError(signOutError);return}
    finishRecovery('/login')
    setEmail('')
    navigate('/login',{replace:true})
  }
  return <div className="shell">
    <header><strong>Violin Invoices</strong><div className="account"><span>{email}</span><button type="button" onClick={logout}>Log out</button></div></header>
    {logoutError&&<p className="error account-error" role="alert">{logoutError}</p>}
    <nav aria-label="Main navigation">
      <NavLink to="/students">Students</NavLink>
      <NavLink to="/lessons">Lessons</NavLink>
      <NavLink to="/invoices">Invoices</NavLink>
      <NavLink to="/settings">Settings</NavLink>
    </nav>
    <main>{children}</main>
  </div>
}
