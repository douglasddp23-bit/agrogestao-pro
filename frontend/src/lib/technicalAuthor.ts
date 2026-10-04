import { doc, getDoc } from 'firebase/firestore';
import { db } from './firebase';

export async function technicalAuthorOf(record: { createdBy: string; technicalAuthor?: { uid: string; name: string; registration: string } }) {
  let author = record.technicalAuthor;
  const uid = author?.uid || record.createdBy;
  if ((!author?.name || !author.registration) && uid) {
    const snapshot = await getDoc(doc(db, 'users', uid));
    if (snapshot.exists()) author = { uid, name: author?.name || snapshot.data().displayName || '', registration: snapshot.data().professionalCertification || '' };
  }
  if (!author?.name || !author.registration) throw new Error('Preencha o nome e o registro profissional do autor do laudo antes de gerar o PDF.');
  return author;
}
