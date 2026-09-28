export type ConsentKey =
  | "privacy"
  | "image_use"
  | "fam_data"
  | "club_rules"
  | "recurring_payment";

type ConsentDocument = {
  title: string;
  summary: string;
  paragraphs: string[];
  optional?: boolean;
  href?: string;
};

const documents: Record<ConsentKey, ConsentDocument> = {
  privacy: {
    title: "Protección de datos",
    summary: "Información sobre los datos de inscripción y actividad deportiva.",
    paragraphs: [
      "CDB Atletas de Fuenlabrada, NIF G67910455, tratará los datos de la persona responsable y de los atletas para tramitar el alta, gestionar entrenamientos, licencias, comunicaciones, cuotas y servicios del club.",
      "Puedes ejercer tus derechos en info@atletasdefuenlabrada.com y reclamar ante la Agencia Española de Protección de Datos.",
    ],
    href: "/privacypolicy.html",
  },
  image_use: {
    title: "Autorización de imagen",
    summary: "Uso informativo y promocional de fotografías o vídeos. No es obligatorio.",
    paragraphs: [
      "Autorizas al club a captar y publicar imágenes del atleta, de forma individual o colectiva, en la web, aplicación, redes sociales y materiales informativos o promocionales vinculados a la actividad deportiva.",
      "Esta autorización es voluntaria y puede retirarse para publicaciones futuras escribiendo al club, sin afectar a los usos realizados lícitamente con anterioridad.",
    ],
    optional: true,
  },
  fam_data: {
    title: "Tramitación de licencia FAM",
    summary: "Información necesaria para tramitar la licencia federativa solicitada.",
    paragraphs: [
      "El club tratará y remitirá a la Federación de Atletismo de Madrid los datos imprescindibles para tramitar o renovar la licencia solicitada. La base jurídica es la ejecución de la relación deportiva y federativa.",
      "La Federación tratará los datos como responsable independiente. La licencia permanecerá pendiente hasta que el club revise la solicitud y complete la tramitación.",
    ],
  },
  club_rules: {
    title: "Normativa del club y condiciones de uso",
    summary: "Normas de convivencia, seguridad, cuenta y servicios digitales del club.",
    paragraphs: [
      "La cuenta es personal. Te comprometes a aportar información correcta, proteger tus credenciales, respetar a compañeros, entrenadores y personal, y utilizar la plataforma únicamente para las finalidades del club.",
      "Aceptas las condiciones de uso vigentes de la aplicación Atletas de Fuenlabrada y la normativa de convivencia, asistencia, seguridad y uso responsable de las instalaciones.",
    ],
    href: "/app-terms.html",
  },
  recurring_payment: {
    title: "Cuotas y cargos recurrentes",
    summary: "Autorización del plan elegido, siempre después de la revisión administrativa.",
    paragraphs: [
      "Aceptas la cuota seleccionada en esta solicitud y que los futuros cargos se realicen mediante el proveedor seguro que configure el club.",
      "No se realiza ningún cargo al enviar el formulario. Administración revisará matrícula, fecha de alta y descuentos antes de solicitar la vinculación del medio de pago.",
    ],
  },
};

const consentKeys = Object.keys(documents) as ConsentKey[];

export default function ConsentChecklist({
  values,
  onChange,
  requiresFam = "fam_data" in values,
}: {
  values: Record<string, boolean>;
  onChange: (key: ConsentKey, checked: boolean) => void;
  requiresFam?: boolean;
}) {
  return (
    <div className="consents">
      {consentKeys.map(key => {
        if (key === "fam_data" && !requiresFam) return null;
        const document = documents[key];
        return (
          <div className="consent-item" key={key}>
            <label>
              <input
                type="checkbox"
                checked={values[key]}
                onChange={event => onChange(key, event.target.checked)}
              />
              <span>
                <b>{document.title}</b>
                <small>{document.summary} · {document.optional ? "Opcional" : "Obligatorio"}</small>
              </span>
            </label>
            <details>
              <summary>Leer lo que aceptas <span aria-hidden="true">＋</span></summary>
              <div className="consent-document">
                <strong>{document.title}</strong>
                {document.paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
                {document.href && <p><a href={document.href} target="_blank" rel="noreferrer">Consultar el documento completo</a></p>}
                <small>Versión 28-09-2026 · La aceptación queda registrada con la solicitud.</small>
              </div>
            </details>
          </div>
        );
      })}
    </div>
  );
}
