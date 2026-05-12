const About = () => {
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold mb-2 text-inadvertent-yellow">About</h1>
          </div>
            
            <div className="bg-card p-8 rounded-lg shadow-md border border-border">
              <p className="mb-6">
                No Secret Police is a public records database created by <a href="https://inadvertent.substack.com/" target="_blank" rel="noopener noreferrer" className="text-inadvertent-yellow hover:text-inadvertent-yellow-hover underline">Inadvertent</a>.
              </p>
              
              <p className="mb-6">
                This database was created to bring transparency to police agencies in California. It is a tool for the public to learn about their local police department without depending on the police for information. Records displayed are public records and have been sourced through public records requests or lawsuits enforcing public records requests.
              </p>
              
              <p className="mb-6">
                The database currently hosts one agency's records and gives the public access to be able to learn about the department. If you have records to contribute to this database or if you want to learn how to source this type of data from your local police agency, please <a href="https://inadvertent.substack.com/p/contact" target="_blank" rel="noopener noreferrer" className="text-inadvertent-yellow hover:text-inadvertent-yellow-hover underline">reach out</a> to us.
              </p>

              <h2 className="text-2xl font-bold mb-4 text-inadvertent-yellow">Why does this database include only the Santa Ana Police Department?</h2>
              <p className="mb-6">
                Consider this database an evergreen project, meaning that it will be updated as more records become available. The Santa Ana Police Department's (SAPD) records are displayed because SAPD was the first California department to release its officer headshot photographs.
              </p>
              
              <p className="mb-6">
                Journalists and members of the public are welcome to contribute these same types of records to this database.
              </p>

              <h2 className="text-2xl font-bold mb-4 text-inadvertent-yellow">How did we get here?</h2>
              <p className="mb-6">
                This database is the culmination of years of work by <a href="https://bencamacho.com/about" target="_blank" rel="noopener noreferrer" className="text-inadvertent-yellow hover:text-inadvertent-yellow-hover underline">Ben Camacho</a>, the award-winning journalist behind Inadvertent. On May 5, 2021, off-duty <a href="https://inadvertent.substack.com/p/sapd-gang" target="_blank" rel="noopener noreferrer" className="text-inadvertent-yellow hover:text-inadvertent-yellow-hover underline">SAPD Major Enforcement Team (MET)</a> Detective John Rodriguez was involved in a fight in Downtown Santa Ana. The city of Santa Ana refused to identify the officer, which resulted in Camacho requesting the SAPD's headshot photographs and roster so that he could identify the officer. Initially, the Santa Ana Police Officers Association (SAPOA) tried to stop the release of these public records using the court. They failed to do this because photographs and basic data about public employees are a public record and cannot be censored. The SAPOA's failure in court and <a href="https://inadvertent.substack.com/t/sapd-gang" target="_blank" rel="noopener noreferrer" className="text-inadvertent-yellow hover:text-inadvertent-yellow-hover underline">reporting that emerged</a> from the investigation into this officer showed the value in knowing how to navigate the California Public Records Act and knowing who works at a local police agency.
              </p>
              
              <p className="mb-6">
                A few months after SAPD released the records, Camacho requested the same kind of records from the Los Angeles Police Department (LAPD) after observing a pattern of misconduct such as police refusing to identify, shining flashlights into cameras, and hiding badge numbers. The LAPD released its roster but refused to release the photographs, essentially stating that releasing those photographs would be too big of a task. The journalist took the city of Los Angeles to court to enforce the request and the city agreed, via settlement, to release the photos. Camacho later shared the photographs with the Stop LAPD Spying Coalition, who published them in a <a href="https://watchthewatchers.net/" target="_blank" rel="noopener noreferrer" className="text-inadvertent-yellow hover:text-inadvertent-yellow-hover underline">database</a>. After pressure from the Los Angeles Police Protective League, the city of LA sued Camacho and the Stop LAPD Spying Coalition in an unconstitutional attempt to censor public records. The case ended with the city paying Camacho and the coalition $300,000 in attorney's fees. A second lawsuit was filed by the city of LA to attempt to hold Camacho and coalition financially responsible for any perceived-damages stemming from the release of the records; this case was also struck down by a judge who cited First Amendment rights. The city again paid over $100,000 in fees to Camacho and the coalition.
              </p>
              
              <p className="mb-6">
                Follow <a href="https://bencamacho.com/the-fight-for-public-records" target="_blank" rel="noopener noreferrer" className="text-inadvertent-yellow hover:text-inadvertent-yellow-hover underline">a more comprehensive summary</a> of the LAPD headshots saga. You can also <a href="https://bencamacho.com/press" target="_blank" rel="noopener noreferrer" className="text-inadvertent-yellow hover:text-inadvertent-yellow-hover underline">read reports about the issue on this page</a>.
              </p>

              <h2 className="text-2xl font-bold mb-4 text-inadvertent-yellow">Is this up to date?</h2>
              <p className="mb-6">
                Roster data for the SAPD is current as of 2026. Payroll data varies per record, ranging from 2024 to 2025, depending on the most recent year for which the city has released that personnel's compensation data. Each profile shows the specific year its payroll reflects. The database is entirely based on the city's data so if you see that something is wrong, it is because updated data has not been released by the city.
              </p>

              <h2 className="text-2xl font-bold mb-4 text-inadvertent-yellow">How can I support this project?</h2>
              <p className="mb-6">
                Maintaining this database is laborious. You can become a <a href="https://inadvertent.substack.com/" target="_blank" rel="noopener noreferrer" className="text-inadvertent-yellow hover:text-inadvertent-yellow-hover underline">paid subscriber to Inadvertent</a> to ensure that the database stays in working condition and continues to be updated. If you would like to make a one-time donation use <a href="https://ko-fi.com/inadvertent" target="_blank" rel="noopener noreferrer" className="text-inadvertent-yellow hover:text-inadvertent-yellow-hover underline">this link</a>.
              </p>
            </div>
          </div>
      </div>
    </div>
  );
};

export default About;
