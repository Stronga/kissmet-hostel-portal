export function ErrorState({ title = "Unable to load dashboard.", message }: { title?: string; message?: string }) {
  return (
    <div role="alert" className="rounded-token border border-red-200 bg-red-50 p-4 text-sm">
      <p className="font-medium text-red-800">{title}</p>
      {message ? <p className="mt-1 text-red-700">{message}</p> : null}
    </div>
  );
}
