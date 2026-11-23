import Link from "next/link";
export default function Home() {
  return <main style={{minHeight:"100vh",display:"grid",placeItems:"center",padding:24,background:"radial-gradient(circle at 50% 10%,#142b45,#090e1b 55%)"}}>
    <div style={{maxWidth:850,textAlign:"center"}}>
      <div style={{fontWeight:850,letterSpacing:".12em",fontSize:20}}>ORB<span style={{color:"#39c6d8"}}>O</span>TRIQ</div>
      <p style={{color:"#39c6d8",letterSpacing:".18em",fontSize:11,marginTop:55}}>THE DIGITAL GROWTH OPERATING SYSTEM</p>
      <h1 style={{fontSize:"clamp(38px,7vw,72px)",lineHeight:1.04,margin:"18px 0"}}>One platform.<br/>Complete digital growth.</h1>
      <p style={{color:"#aab8cc",fontSize:17,lineHeight:1.7}}>SEO, AI search visibility, social media, advertising and client management — connected in one workspace.</p>
      <Link href="/dashboard" style={{display:"inline-block",marginTop:28,background:"#39c6d8",color:"#07111e",padding:"13px 22px",borderRadius:10,fontWeight:700}}>Open dashboard →</Link>
    </div>
  </main>;
}
