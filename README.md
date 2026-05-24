<h1>Dead PDF</h1>
<p>I've come to believe that PDF is a dead technology, or at least it should be.  There is very little you can do with a PDF that you can't do with a web page, and the tools you have to use to create and edit a PDF are expensive and awkward to use.  PDFs do give you format preservation and printability, but you can accomplish all these same things in a web page with just a little CSS styling.  There are really only two things left that PDFs offer over web pages:
<ol>
  <li>Portability - email it, save it to a file share, etc. </li>
  <li>Digital signatures - ensure the page is authentic or that the data from a form has not been tampered with</li>
</ol>
Dead PDF fills these gaps.  It's basically a portable little website that you can email around or save to file storage.  It also allows authors to sign their page, so that recipients know it's authentic.  And it allows users to sign whatever data they enter (in the case of a form), so that data collectors can know it hasn't been tampered with.      
</p>
<p>So instead of using expensive proprietary tools to create a PDF, you can use free web development tools to create a web page and distribute that instead.  Just about any technology you can use on a webpage (CSS, JavaScript frameworks, embedded multimedia, etc.) you can use with Dead PDF.  Here's how you create a Dead PDF:
<ol >
  <li>Create a little website locally. Make sure it all falls under one root directory</li>
  <li>Make sure there is an index.html page in the root directory.  This is the initial page Dead PDF loads.</li>
  <li>Reference resources using the dpdf protocol relative to localhost (e.g. "dpdf://localhost/image.jpg" to reference an image called "image.jpg" in the root directory)</li>
  <li>Compress all the files in the root directory into a zipped archive</li>
  <li>Change the extension from .zip to .dpdf</li>
</ol>
That's it!  Now you can view your file with Dead PDF, and you can do with your file whatever you would have done with a regular PDF.  
</p>
<h3>Forms with Dead PDF</h3>
<p>Dead PDF can display any HTML page, including HTML forms.  If you are creating a form, Dead PDF gives you two default functions: one that collects user data into a json object, and one that binds the saved json object to the form.  You don't have to do any of that programming yourself, unless you want to.  If you do, you can easily override the default functions with your own custom ones.  Regardless of how you collect the data from the form, it will be saved to a file called data.json and saved to the dpdf zipped archive.</p>
<p>By default, Dead PDF collects the data by mapping all of the form fields to a json object  The main object has one property, the name of the form.  The value of this one property is an object containing all the form data.  The name of each input element of the form corresponds to a property of this data object, and the values of the input elements become the values of the data object properties.  If there are two input elements with the same name, (e.g. in the case of checkboxes) then the value of the data object property becomes an array</p>
<p>For example, suppose you have the following form:<br/>
  <pre>
  &ltform name="testform"&gt
    Enter your name &ltbr/&gt
    &ltinput name="name" /&gt&ltbr/&gt
    What flavors do you like?
    &ltinput name="flavors" type="checkbox" value="vanilla"&gtvanilla&ltbr/&gt
    &ltinput name="flavors" type="checkbox" value="chocolate"&gtchocolate&ltbr/&gt
    &ltinput name="flavors" type="checkbox" value="strawberry"&gtstrawberry&ltbr/&gt
    &ltinput name="flavors" type="checkbox" value="coffee"&gtcoffee&ltbr/&gt
    &ltinput id="submit" type="button" value="Submit" /&gt
  &lt/form&gt  
  </pre>
  Now suppose you enter "Bob" for the name and check the vanilla and coffee checkboxes, the resulting data.json would contain:
  <br/>
  <pre>
    {
      "testform":{
        "name":"Bob",
        "flavors":["vanilla","coffee"]
      }
    }
  </pre>
</p>
<p>
Sometimes, you may want to group properties into a nested object.  Use the fieldset tag to do that.  For example, if we take the above form, and add a fieldset tag:
  <pre>
  &lt;form name="testform"&gt;
    Enter your name &ltbr/&gt;
    &lt;input name="name" /&gt;&lt;br/&gt;
    &lt;fieldset name="flavor_preferences"&gt;
      What flavors do you like?
      &lt;input name="flavors" type="checkbox" value="vanilla"&gtvanilla&ltbr/&gt;
      &lt;input name="flavors" type="checkbox" value="chocolate"&gtchocolate&ltbr/&gt;
      &lt;input name="flavors" type="checkbox" value="strawberry"&gtstrawberry&ltbr/&gt;
      &lt;input name="flavors" type="checkbox" value="coffee"&gtcoffee&ltbr/&gt;
      &lt;input id="submit" type="button" value="Submit" /&gt;
    &lt;/fieldset&gt;
  &lt/form&gt;  
  </pre>
  The json collected from the form now looks like this:
  <br/>
    <pre>
    {
      "testform":{
        "name":"Bob",
        "flavor_preferences":{
          "flavors":["vanilla","coffee"]
        }
      }
    }
  </pre>

</p>
<p>When you open a dpdf file, Dead PDF looks for the data.json file.  If it is there, it will attempt to load the data automatically into the form.  You can override this default behavior with your own function, but if you use the default function to collect the data, then the default function to bind the data to the form will just work.</p>