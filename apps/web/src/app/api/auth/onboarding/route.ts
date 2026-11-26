import { NextRequest,NextResponse } from "next/server";
import { isAdminWriteEnabled } from "@/lib/admin/write-guard";
import { completeOnboarding } from "@/lib/auth/onboarding";
import { COOKIE_NAME } from "@/lib/auth/session";
export const runtime="nodejs";
export async function POST(request:NextRequest){
 if(!isAdminWriteEnabled()||request.headers.get("origin")!==request.nextUrl.origin)return NextResponse.json({error:"Access denied."},{status:403});
 if(request.headers.get("content-type")?.split(";")[0].trim().toLowerCase()!=="application/json")return NextResponse.json({error:"JSON request required."},{status:415});
 let input:unknown;
 try{const body=await request.text();if(body.length>30000)return NextResponse.json({error:"Request too large."},{status:413});input=JSON.parse(body);}catch{return NextResponse.json({error:"Invalid request."},{status:400});}
 try{
  const result=await completeOnboarding(input);
  if(!result.ok)return NextResponse.json({error:result.error},{status:result.status});
  const response=NextResponse.json({success:true});
  response.cookies.set(COOKIE_NAME,"",{httpOnly:true,sameSite:"lax",path:"/",maxAge:0});
  return response;
 }catch{return NextResponse.json({error:"Password setup failed."},{status:500});}
}
