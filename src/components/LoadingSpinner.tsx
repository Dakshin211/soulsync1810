export default function LoadingSpinner({ message = 'Loading...' }: { message?: string }) {
  return (
    <div className="flex justify-center py-12 animate-fade-in">
      <div className="flex flex-col items-center gap-3">
        <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}
