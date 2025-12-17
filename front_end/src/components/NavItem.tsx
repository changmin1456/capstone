import { NavLink } from "react-router-dom";

export default function NavItem({
  to,
  label,
}: {
  to: string;
  label: string;
}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `px-3 py-2 rounded-lg text-sm font-medium ${
          isActive
            ? "bg-white/10 text-white"
            : "text-white/70 hover:text-white"
        }`
      }
    >
      {label}
    </NavLink>
  );
}