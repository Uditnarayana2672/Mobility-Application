import { Link } from "react-router-dom";

export default function Placeholder({ title, note }: { title: string; note: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-neutral-950 p-6 text-neutral-100">
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="max-w-md text-center text-neutral-300">{note}</p>
      <Link to="/" className="text-sky-400 underline">
        back to hub
      </Link>
    </div>
  );
}
