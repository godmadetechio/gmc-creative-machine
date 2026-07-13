import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold tracking-tight">GODMADE</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Client Machine — operator sign in
          </p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
