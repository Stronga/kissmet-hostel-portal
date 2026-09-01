export function ErrorState({ title = "Something went wrong", message }: { title?: string; message: string }) {
  return (
    <div className="rounded-token border border-danger/30 bg-[#fff5f4] p-4 text-sm text-danger" role="alert">
      <p className="font-semibold">{title}</p>
      <p className="mt-1">{message}</p>
    </div>
  );
}
