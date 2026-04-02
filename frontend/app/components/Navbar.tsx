// // components/NavBar.tsx
// 'use client'

// import { Button } from "@/components/ui/button"
// import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
// import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
// import { useRouter } from "next/navigation"

// export default function Navbar() {
//   const router = useRouter();

//   return (
//     <nav className="flex items-center justify-between px-6 py-4 shadow-md bg-white dark:bg-zinc-900">
//       <div className="text-xl font-bold cursor-pointer" onClick={() => router.push('/')}>
//         🎬 YT Video Downloader
//       </div>

//       <div className="flex items-center gap-4">
//         <Button variant="ghost" onClick={() => router.push("/downloads")}>
//           History
//         </Button>

//         <DropdownMenu>
//           <DropdownMenuTrigger>
//             <Avatar className="cursor-pointer">
//               <AvatarImage src="https://github.com/shadcn.png" alt="User" />
//               <AvatarFallback>U</AvatarFallback>
//             </Avatar>
//           </DropdownMenuTrigger>
//           <DropdownMenuContent align="end">
//             <DropdownMenuItem onClick={() => alert("Profile clicked")}>Profile</DropdownMenuItem>
//             <DropdownMenuItem onClick={() => alert("Settings clicked")}>Settings</DropdownMenuItem>
//             <DropdownMenuItem onClick={() => alert("Logout clicked")}>Logout</DropdownMenuItem>
//           </DropdownMenuContent>
//         </DropdownMenu>
//       </div>
//     </nav>
//   )
// }



//trying the tooogel dark or light mode 

'use client'

import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useTheme } from "next-themes"
import { Moon, Sun, Clapperboard } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"

export default function NavBar() {
  const router = useRouter()
  const { setTheme, theme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  return (
    <div className="border-b shadow-sm bg-white dark:bg-zinc-900">
      <div className="flex items-center justify-between px-6 py-4">
        <div
          className="text-xl font-bold cursor-pointer"
          onClick={() => router.push("/")}
        >
          <Clapperboard className="inline h-5 w-5 mr-1" /> YT Downloader
        </div>

        <div className="flex items-center gap-4">
          {mounted && (
            <Button variant="ghost" size="icon" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
              {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </Button>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger>
              <Avatar className="cursor-pointer">
                <AvatarImage src="https://github.com/shadcn.png" alt="user" />
                <AvatarFallback>U</AvatarFallback>
              </Avatar>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => alert("Profile clicked")}>Profile</DropdownMenuItem>
              <DropdownMenuItem onClick={() => alert("Settings clicked")}>Settings</DropdownMenuItem>
              <DropdownMenuItem onClick={() => alert("Logout clicked")}>Logout</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Tabs for navigation */}
      {/* <Tabs defaultValue="home" className="px-6 pb-2">
        <TabsList>
          <TabsTrigger value="home" onClick={() => router.push("/")}>Video</TabsTrigger>
          <TabsTrigger value="playlist" onClick={() => router.push("/playlist")}>Playlist</TabsTrigger>
          <TabsTrigger value="downloads" onClick={() => router.push("/downloads")}>Downloads</TabsTrigger>
        </TabsList>
      </Tabs> */}
    </div>
  )
}
