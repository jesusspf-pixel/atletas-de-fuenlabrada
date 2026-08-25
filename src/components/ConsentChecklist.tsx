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
};

const documents: Record<ConsentKey, ConsentDocument> = {
  privacy: {
    title: "Protección de datos",
    summary: "Tratamiento de los datos necesarios para gestionar la inscripción y la actividad deportiva.",
    paragraphs: [
      "El Club Atletas de Fuenlabrada tratará los datos de la persona responsable y de los atletas para tramitar el alta, gestionar entrenamientos, licencias, comunicaciones y cobros.",
      "Los datos se comunicarán únicamente a proveedores necesarios para prestar el servicio y, cuando corresponda, a la Federación de Atletismo de Madrid. Podrás solicitar acceso, rectificación, supresión, limitación u oposición mediante los canales oficiales del club.",
    ],
  },
  image_use: {
    title: "Cesión de imágenes",
    summary: "Uso de fotografías o vídeos tomados durante actividades y eventos del club.",
    paragraphs: [
      "Autorizas la publicación de imágenes del atleta en los canales informativos y promocionales del club, incluidas web y redes sociales, siempre vinculadas a su actividad deportiva.",
      "La autorización puede retirarse para publicaciones futuras comunicándolo al club, sin afectar a los usos realizados con anterioridad.",
    ],
  },
  fam_data: {
    title: "Formulario FAM",
    summary: "Envío de los datos necesarios para tramitar la licencia federativa cuando proceda.",
    paragraphs: [
      "Autorizas al club a preparar y remitir a la Federación de Atletismo de Madrid los datos imprescindibles para tramitar o renovar la licencia del atleta.",
      "La licencia permanecerá pendiente hasta que la administración del club revise la solicitud y complete la tramitación federativa.",
    ],
  },
  club_rules: {
    title: "Normativa del club",
    summary: "Compromiso de convivencia, asistencia, seguridad y uso responsable de las instalaciones.",
    paragraphs: [
      "El atleta y su familia se comprometen a respetar a compañeros, entrenadores y personal, seguir las indicaciones técnicas y de seguridad, cuidar el material y comunicar ausencias o incidencias relevantes.",
      "El club podrá reorganizar grupos y horarios por criterios deportivos, de edad, aforo o disponibilidad de instalaciones, informando de los cambios a las familias.",
    ],
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
}: {
  values: Record<string, boolean>;
  onChange: (key: ConsentKey, checked: boolean) => void;
}) {
  return (
    <div className="consents">
      {consentKeys.map(key => {
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
                <small>{document.summary}</small>
              </span>
            </label>
            <details>
              <summary>Leer lo que aceptas <span aria-hidden="true">＋</span></summary>
              <div className="consent-document">
                <strong>{document.title}</strong>
                {document.paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
                <small>Versión de inscripción 2026/27 · pendiente de sustitución por el documento legal definitivo del club.</small>
              </div>
            </details>
          </div>
        );
      })}
    </div>
  );
}
