import type { PropsWithChildren } from "react";

type SectionCardProps = PropsWithChildren<{
  eyebrow?: string;
  title: string;
  description?: string;
  className?: string;
}>;

export default function SectionCard({
  eyebrow,
  title,
  description,
  className,
  children
}: SectionCardProps) {
  return (
    <section className={`section-card ${className ?? ""}`.trim()}>
      <header className="section-card__header">
        {eyebrow ? <p className="section-card__eyebrow">{eyebrow}</p> : null}
        <div>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
      </header>
      {children}
    </section>
  );
}
