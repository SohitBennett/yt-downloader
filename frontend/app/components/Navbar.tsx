'use client'

import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useTheme } from "next-themes"
import { Moon, Sun, Clapperboard } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"

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

        <div className="flex items-center gap-2">
          <Link href="/terms" className="text-xs text-muted-foreground hover:underline hidden sm:inline">
            Terms
          </Link>
          <Link href="/privacy" className="text-xs text-muted-foreground hover:underline hidden sm:inline">
            Privacy
          </Link>

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
              <DropdownMenuItem onClick={() => toast.info("Profile coming soon")}>Profile</DropdownMenuItem>
              <DropdownMenuItem onClick={() => router.push("/downloads")}>Downloads</DropdownMenuItem>
              <DropdownMenuItem onClick={() => toast.info("Settings coming soon")}>Settings</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  )
}
